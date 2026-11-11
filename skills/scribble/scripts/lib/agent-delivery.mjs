import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const pendingPath = (target, id) =>
  join(chatDirectory(target.directory, target.chatId), "pending", `${id}.json`);

async function enqueue(target, root, id) {
  const path = pendingPath(target, id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicJson(path, { root });
}

// Upgrade the unreleased catalog-based queue once. Read only small delivery
// records, never saved sessions or screenshot/annotation payloads. Keeping this
// under the consumer lock makes an interrupted upgrade safe to repeat.
async function migrateOutbox(index, directory, chatId) {
  const pending = join(index, "pending");
  await mkdir(pending, { recursive: true, mode: 0o700 });
  if (await optional(join(pending, ".migrated"))) return pending;
  const names = (await readdir(index)).filter(
    (name) => name !== "connection.json" && name.endsWith(".json"),
  );
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!safeId(id)) continue;
    try {
      const { root } = await readJson(join(index, name));
      await locked(root, id, async () => {
        const status = await agentDeliveryStatus(root, id);
        if (
          status.queuedAt &&
          !status.error &&
          !status.acceptedAt &&
          !status.readAt
        )
          await enqueue({ directory, chatId }, root, id);
      });
    } catch (error) {
      console.error(
        `Scribble: skipping legacy delivery ${id}: ${error.message}`,
      );
    }
  }
  await atomicJson(join(pending, ".migrated"), {});
  return pending;
}

export async function bindAgentDelivery(root, id, target) {
  const directory = chatDirectory(target.directory, target.chatId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
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
    if (status.acceptedAt || status.readAt) return status;
    const dir = sessionDir(root, id);
    const target = await readJson(join(dir, "agent-target.json"));
    // Publish the index before committing the request, under the canvas lock.
    // A crash can leave an unused index entry, never undiscoverable queued work.
    // Repeating Send also repairs an interrupted write without changing its ID.
    await enqueue(target, root, id);
    if (!status.queuedAt || status.error)
      await atomicJson(join(dir, "agent-delivery.json"), {
        id: randomUUID(),
        requestedAt: new Date().toISOString(),
      });
    return agentDeliveryStatus(root, id);
  });
}

// The MCP runtime owns queue and receipt transitions. Poll only the active
// outbox; completed canvas history and feedback payloads stay off this path.
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
    const pending = await migrateOutbox(index, directory, chatId);
    const names = (await readdir(pending))
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!safeId(id)) continue;
      try {
        const path = join(pending, name);
        const { root } = await readJson(path);
        const item = await locked(root, id, async () => {
          const dir = sessionDir(root, id);
          const target = await optional(join(dir, "agent-target.json"));
          if (target?.chatId !== chatId || target.directory !== directory) {
            await rm(path, { force: true });
            return null;
          }
          const [request, status] = await Promise.all([
            optional(join(dir, "agent-delivery.json")),
            agentDeliveryStatus(root, id),
          ]);
          if (!request || request.error || status.acceptedAt || status.readAt) {
            await rm(path, { force: true });
            return null;
          }
          if (
            request.consumer &&
            request.consumer !== consumer &&
            now - request.claimedAt < LEASE_MS
          )
            return null;
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
      } catch (error) {
        // A corrupt or unavailable project must not block another canvas.
        console.error(
          `Scribble: skipping pending delivery ${id}: ${error.message}`,
        );
      }
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
  const path = pendingPath({ directory, chatId }, item.sessionId);
  const record = await optional(path);
  if (!record) return; // Repeated acknowledgements are idempotent.
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
    // Receipts are committed before removing work. A crash leaves a stale
    // entry that the next poll discards without ever submitting it again.
    await rm(path, { force: true });
  });
}
