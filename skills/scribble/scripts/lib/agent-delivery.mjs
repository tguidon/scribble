import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  atomicJson,
  readJson,
  loadSession,
  loadSubmission,
  sessionDir,
  safeId,
} from "./store.mjs";
import { withLock } from "./lock.mjs";
import { feedbackMessage, feedbackMarker } from "./feedback-message.mjs";

const LEASE_MS = 15000;
const optional = (path) =>
  readJson(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const chatDirectory = (directory, chatId) => {
  if (!safeId(chatId)) throw new Error("Invalid chat ID.");
  return join(directory, "claude-chats", chatId);
};
const locked = (root, id, task) =>
  withLock(sessionDir(root, id), "agent-delivery.lock", task);

export async function bindAgentDelivery(root, id, target) {
  const directory = chatDirectory(target.directory, target.chatId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // One index entry per canvas avoids read/modify/write races between chats.
  await atomicJson(join(directory, `${id}.json`), { root });
  await atomicJson(join(target.directory, `${id}.json`), { root });
  const dir = sessionDir(root, id);
  await atomicJson(join(dir, "agent-target.json"), target);
  const session = await loadSession(root, id);
  await atomicJson(join(dir, "session.json"), {
    ...session,
    deliveryHost: "claude-code",
  });
}

export async function inheritAgentDelivery(root, previousId, nextId) {
  const target = await optional(
    join(sessionDir(root, previousId), "agent-target.json"),
  );
  if (target) await bindAgentDelivery(root, nextId, target);
}

export async function agentDeliveryStatus(root, id) {
  const dir = sessionDir(root, id);
  const [target, request, accepted, read] = await Promise.all([
    optional(join(dir, "agent-target.json")),
    optional(join(dir, "agent-delivery.json")),
    optional(join(dir, "plugin-delivery.json")),
    optional(join(dir, "plugin-read.json")),
  ]);
  const connection =
    target &&
    (await optional(
      join(chatDirectory(target.directory, target.chatId), "connection.json"),
    ));
  return {
    available: !!target,
    connected: !!connection && Date.now() - connection.at < LEASE_MS,
    queuedAt: request?.requestedAt || null,
    acceptedAt: accepted?.acceptedAt || null,
    readAt: read?.readAt || null,
    error: request?.error || null,
  };
}

export async function requestAgentDelivery(root, id) {
  return locked(root, id, async () => {
    const status = await agentDeliveryStatus(root, id);
    if (!status.available)
      throw Object.assign(
        new Error(
          "This canvas has no connected chat. Copy the handoff instead.",
        ),
        { status: 409 },
      );
    if (!(await loadSubmission(root, id)))
      throw Object.assign(new Error("Finish feedback before sending it."), {
        status: 409,
      });
    if (
      status.acceptedAt ||
      status.readAt ||
      (status.queuedAt && !status.error)
    )
      return status;
    await atomicJson(join(sessionDir(root, id), "agent-delivery.json"), {
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
    });
    return agentDeliveryStatus(root, id);
  });
}

// Used by the local mod helper, never exposed as a browser endpoint. Only this
// chat's index is read; polling never selects a project's latest submission.
export async function pollAgentDelivery(directory, chatId, consumer) {
  const index = chatDirectory(directory, chatId);
  return withLock(index, "consumer.lock", async () => {
    const now = Date.now();
    const connection = await optional(join(index, "connection.json"));
    if (
      connection &&
      connection.consumer !== consumer &&
      now - connection.at < LEASE_MS
    )
      return null;
    await atomicJson(join(index, "connection.json"), { at: now, consumer });
    const names = (await readdir(index))
      .filter((name) => name !== "connection.json" && name.endsWith(".json"))
      .sort();
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!safeId(id)) continue;
      const { root } = await readJson(join(index, name));
      // Registry entries can outlive a deleted project's local storage.
      const session = await loadSession(root, id).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!session) continue;
      const item = await locked(root, id, async () => {
        const dir = sessionDir(root, id);
        const target = await optional(join(dir, "agent-target.json"));
        if (target?.chatId !== chatId || target.directory !== directory)
          return null;
        const [request, status] = await Promise.all([
          optional(join(dir, "agent-delivery.json")),
          agentDeliveryStatus(root, id),
        ]);
        if (!request || request.error || status.acceptedAt || status.readAt)
          return null;
        if (
          request.consumer &&
          request.consumer !== consumer &&
          now - request.claimedAt < LEASE_MS
        )
          return null;
        if (!(await loadSubmission(root, id))) return null;
        await atomicJson(join(dir, "agent-delivery.json"), {
          ...request,
          consumer,
          claimedAt: now,
        });
        return {
          sessionId: id,
          requestId: request.id,
          text: feedbackMessage(id),
          marker: feedbackMarker(id),
        };
      });
      if (item) return item;
    }
    return null;
  });
}

export async function settleAgentDelivery(
  directory,
  chatId,
  consumer,
  item,
  error,
) {
  if (!safeId(item?.sessionId)) throw new Error("Invalid canvas ID.");
  const record = await readJson(
    join(chatDirectory(directory, chatId), `${item.sessionId}.json`),
  );
  return locked(record.root, item.sessionId, async () => {
    const dir = sessionDir(record.root, item.sessionId);
    const target = await readJson(join(dir, "agent-target.json"));
    const request = await readJson(join(dir, "agent-delivery.json"));
    if (
      target.chatId !== chatId ||
      target.directory !== directory ||
      request.id !== item.requestId ||
      request.consumer !== consumer
    )
      return;
    if (error)
      await atomicJson(join(dir, "agent-delivery.json"), {
        ...request,
        error:
          "Delivery paused. Resume Claude Code, then retry sending this feedback.",
      });
    else
      await atomicJson(join(dir, "plugin-delivery.json"), {
        acceptedAt: new Date().toISOString(),
      });
  });
}
