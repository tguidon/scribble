import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import {
  createSession,
  atomicJson,
  readJson,
  sessionDir,
} from "../skills/scribble/scripts/lib/store.mjs";
import {
  pollAgentDelivery,
  settleAgentDelivery,
  agentDeliveryStatus,
} from "../skills/scribble/scripts/lib/agent-delivery.mjs";
import { PluginBackend } from "../plugin/backend.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function setup(t) {
  const project = await mkdtemp(join(tmpdir(), "scribble-delivery-"));
  const root = join(project, ".scribble");
  const server = await startServer({
    root,
    session: await createSession(root),
  });
  const directory = join(project, "registry");
  const backend = new PluginBackend({ directory });
  t.after(async () => {
    await server.close();
    await rm(project, { recursive: true, force: true });
  });
  const call = (canvas, path, method = "GET", data) =>
    fetch(new URL(`/api${path}`, canvas.url), {
      method,
      headers: {
        Authorization: `Bearer ${canvas.token}`,
        "X-Scribble-Session": canvas.sessionId,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? data
            : JSON.stringify(data),
    });
  const finish = async (canvas) => {
    const upload = await call(
      canvas,
      "/images?revision=0&imageId=original&width=1&height=1&name=proof.png",
      "POST",
      png,
    );
    const draft = await upload.json();
    assert.equal(upload.status, 201);
    assert.equal(
      (await call(canvas, "/submit", "POST", { revision: draft.revision }))
        .status,
      200,
    );
  };
  return { project, root, directory, backend, call, finish };
}

test("browser Send queues only explicit finished feedback, isolates chats, and survives reconnects", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  const one = await backend.open(project, "First chat", "chat-one");
  const two = await backend.open(project, "Second chat", "chat-two");
  const standalone = await backend.open(project, "Codex");
  assert.equal(
    (await (await call(one, "/session")).json()).deliveryHost,
    "claude-code",
  );
  assert.equal((await call(one, "/delivery", "POST", {})).status, 409);
  assert.equal((await call(standalone, "/delivery", "POST", {})).status, 409);
  assert.equal(
    (await call({ ...one, token: two.token }, "/delivery", "POST", {})).status,
    401,
  );
  await finish(one);
  await finish(two);
  assert.equal(
    await pollAgentDelivery(directory, "chat-one", "consumer-one"),
    null,
  );
  await Promise.all([
    call(one, "/delivery", "POST", {}),
    call(one, "/delivery", "POST", {}),
  ]);
  const queued = await readJson(
    join(sessionDir(root, one.sessionId), "agent-delivery.json"),
  );
  await call(one, "/delivery", "POST", {});
  assert.equal(
    (
      await readJson(
        join(sessionDir(root, one.sessionId), "agent-delivery.json"),
      )
    ).id,
    queued.id,
  );
  assert.equal(
    await pollAgentDelivery(directory, "chat-two", "consumer-two"),
    null,
  );
  const item = await pollAgentDelivery(directory, "chat-one", "consumer-one");
  assert.equal(item.sessionId, one.sessionId);
  assert.match(item.text, new RegExp(one.sessionId));
  assert.equal(
    await pollAgentDelivery(directory, "chat-one", "other-consumer"),
    null,
  );
  await settleAgentDelivery(directory, "chat-one", "consumer-one", item);
  const reconnected = new PluginBackend({ directory });
  assert.ok((await reconnected.delivery(one.sessionId, one.token)).acceptedAt);
  assert.equal(
    await pollAgentDelivery(directory, "chat-one", "consumer-one"),
    null,
  );
  await reconnected.feedback(one.sessionId);
  assert.ok((await agentDeliveryStatus(root, one.sessionId)).readAt);
});

test("paused deliveries retry explicitly, reject stale acknowledgements, and recover expired leases", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  const canvas = await backend.open(project, "Retry", "chat-one");
  await finish(canvas);
  await call(canvas, "/delivery", "POST", {});
  const old = await pollAgentDelivery(directory, "chat-one", "first");
  await settleAgentDelivery(directory, "chat-one", "first", old, "stopped");
  assert.match(
    (await agentDeliveryStatus(root, canvas.sessionId)).error,
    /Resume Claude Code/,
  );
  assert.equal(await pollAgentDelivery(directory, "chat-one", "first"), null);
  await call(canvas, "/delivery", "POST", {});
  const retry = await pollAgentDelivery(directory, "chat-one", "first");
  assert.notEqual(retry.requestId, old.requestId);
  await settleAgentDelivery(directory, "chat-one", "first", old);
  assert.equal(
    (await agentDeliveryStatus(root, canvas.sessionId)).acceptedAt,
    null,
  );
  await atomicJson(join(directory, "claude-chats/chat-one/connection.json"), {
    at: 0,
    consumer: "first",
  });
  const requestPath = join(
    sessionDir(root, canvas.sessionId),
    "agent-delivery.json",
  );
  await atomicJson(requestPath, {
    ...(await readJson(requestPath)),
    claimedAt: 0,
  });
  const recovered = await pollAgentDelivery(directory, "chat-one", "second");
  assert.equal(recovered.requestId, retry.requestId);
  await settleAgentDelivery(directory, "chat-one", "first", retry);
  assert.equal(
    (await agentDeliveryStatus(root, canvas.sessionId)).acceptedAt,
    null,
  );
  await settleAgentDelivery(directory, "chat-one", "second", recovered);
  assert.ok((await agentDeliveryStatus(root, canvas.sessionId)).acceptedAt);
});

test("browser New canvas inherits delivery and registers originals for the shared MCP backend", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  const canvas = await backend.open(project, "Round one", "chat-one");
  await finish(canvas);
  const exec = promisify(execFile);
  await exec("git", ["-C", project, "init", "--quiet"]);
  const response = await call(canvas, "/sessions", "POST", {});
  assert.equal(response.status, 200);
  assert.equal(
    (
      await exec("git", [
        "-C",
        project,
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        ".scribble",
      ])
    ).stdout,
    "",
  );
  const next = new URL((await response.json()).url, canvas.url);
  const params = new URLSearchParams(next.hash.slice(1));
  const fresh = {
    sessionId: params.get("session"),
    token: params.get("token"),
    url: next.href,
  };
  assert.equal(
    (await (await call(fresh, "/session")).json()).deliveryHost,
    "claude-code",
  );
  await finish(fresh);
  await call(fresh, "/delivery", "POST", {});
  const item = await pollAgentDelivery(directory, "chat-one", "consumer");
  assert.equal(item.sessionId, fresh.sessionId);
  const reconnected = new PluginBackend({ directory });
  const feedback = await reconnected.feedback(fresh.sessionId);
  assert.equal(feedback.bundle.sessionId, fresh.sessionId);
  assert.equal(
    (await reconnected.image(fresh.sessionId, "original")).data,
    png.toString("base64"),
  );
  assert.equal(
    (
      await readFile(
        join(sessionDir(root, fresh.sessionId), "agent-target.json"),
        "utf8",
      )
    ).includes("chat-one"),
    true,
  );
});
