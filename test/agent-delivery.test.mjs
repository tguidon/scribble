import { test } from "node:test";
import assert from "node:assert/strict";
import fs, {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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
import { createPlugin } from "../plugin/mcp.mjs";
import { register } from "../plugin/claude/register.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test("the Claude mod delivers and records feedback through the existing MCP connection", async (t) => {
  const { project, root, backend, call, finish } = await setup(t);
  const plugin = createPlugin({ backend, harness: "claude-code" });
  const client = new Client({ name: "claude-mod-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await plugin.server.connect(back);
  await client.connect(front);
  t.after(async () => {
    await client.close();
    await plugin.close();
  });
  const tools = await client.listTools();
  for (const name of ["poll_delivery", "settle_delivery"])
    assert.deepEqual(
      tools.tools.find((tool) => tool.name === name)._meta.ui.visibility,
      ["app"],
    );
  const handlers = new Map();
  let timer;
  const messages = [];
  const $ = {
    session: { id: async () => "chat-one", messages: async () => messages },
    clock: {
      every: (_ms, fn) => {
        timer = fn;
        return { cancel() {} };
      },
    },
    mcp: {
      call: (_server, tool, args) =>
        client.callTool({ name: tool, arguments: args }),
    },
    prompt: {
      submit: async ({ text }) => {
        messages.push({ role: "user", text });
        return {};
      },
    },
    ui: { toast: (text) => assert.fail(text) },
  };
  register((event, handler) => handlers.set(event, handler));
  const next = (event) => event;
  await handlers.get("session.start")($, {}, next);
  const input = await handlers.get("tool.call")(
    $,
    {
      tool: "mcp__plugin_scribble_scribble__open_canvas",
      projectPath: project,
    },
    next,
  );
  const { tool, ...args } = input;
  const opened = await client.callTool({
    name: "open_canvas",
    arguments: args,
  });
  assert.ok(!opened.isError, JSON.stringify(opened));
  const canvas = opened._meta.scribble;
  await finish(canvas);
  await call(canvas, "/delivery", "POST", {});
  await timer();
  // Deliver runs independently of polling while prompt.submit waits for idle.
  for (
    let i = 0;
    i < 100 && !(await agentDeliveryStatus(root, canvas.sessionId)).acceptedAt;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, new RegExp(canvas.sessionId));
  assert.ok((await agentDeliveryStatus(root, canvas.sessionId)).acceptedAt);
  await timer();
  assert.equal(messages.length, 1);
  await handlers.get("session.end")($, {}, next);
});
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
  assert.deepEqual(
    (await readdir(join(directory, "claude-chats/chat-one/pending"))).filter(
      (name) => name.endsWith(".json"),
    ),
    [],
  );
  const reconnected = new PluginBackend({ directory });
  assert.ok((await reconnected.delivery(one.sessionId, one.token)).acceptedAt);
  assert.equal(
    await pollAgentDelivery(directory, "chat-one", "consumer-one"),
    null,
  );
  await reconnected.feedback(one.sessionId);
  assert.ok((await agentDeliveryStatus(root, one.sessionId)).readAt);
});

test("idle polling never reads completed history or feedback payloads", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  const canvas = await backend.open(project, "Completed", "chat-one");
  await finish(canvas);
  await call(canvas, "/delivery", "POST", {});
  const item = await pollAgentDelivery(directory, "chat-one", "consumer");
  await settleAgentDelivery(directory, "chat-one", "consumer", item);
  const index = join(directory, "claude-chats/chat-one");
  // Simulate a large pre-upgrade history, including a malformed old record.
  for (let i = 0; i < 20; i++)
    await atomicJson(join(index, `old-${i}.json`), { root });
  await writeFile(join(index, "000-broken.json"), "{broken");
  const original = fs.readFile;
  const reads = [];
  fs.readFile = async (path, ...args) => {
    reads.push(String(path));
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(
      await pollAgentDelivery(directory, "chat-one", "consumer"),
      null,
    );
    assert.ok(reads.length < 10, `${reads.length} reads for an idle poll`);
    assert.ok(reads.every((path) => !path.includes(root)));
    assert.ok(reads.every((path) => !/old-|000-broken/.test(path)));
  } finally {
    fs.readFile = original;
    syncBuiltinESMExports();
  }
});

test("a malformed pending entry cannot block healthy feedback", async (t) => {
  const { project, directory, backend, call, finish } = await setup(t);
  const canvas = await backend.open(project, "Healthy", "chat-one");
  await finish(canvas);
  await call(canvas, "/delivery", "POST", {});
  await writeFile(
    join(directory, "claude-chats/chat-one/pending/000-broken.json"),
    "{broken",
  );
  const item = await pollAgentDelivery(directory, "chat-one", "consumer");
  assert.equal(item.sessionId, canvas.sessionId);
});

test("failed index or request writes never leave undiscoverable queued feedback", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  for (const phase of ["index", "request"]) {
    const canvas = await backend.open(project, phase, "chat-one");
    await finish(canvas);
    const target =
      phase === "index"
        ? join(
            directory,
            "claude-chats/chat-one/pending",
            `${canvas.sessionId}.json`,
          )
        : join(sessionDir(root, canvas.sessionId), "agent-delivery.json");
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to === target)
        throw Object.assign(new Error("simulated disk failure"), {
          code: "EIO",
        });
      return rename(from, to);
    };
    syncBuiltinESMExports();
    try {
      assert.equal((await call(canvas, "/delivery", "POST", {})).status, 500);
      assert.equal(
        (await agentDeliveryStatus(root, canvas.sessionId)).queuedAt,
        null,
      );
    } finally {
      fs.rename = rename;
      syncBuiltinESMExports();
    }
    assert.equal(
      await pollAgentDelivery(directory, "chat-one", "consumer"),
      null,
    );
    assert.equal((await call(canvas, "/delivery", "POST", {})).status, 200);
    const item = await pollAgentDelivery(directory, "chat-one", "consumer");
    assert.equal(item.sessionId, canvas.sessionId);
    await settleAgentDelivery(directory, "chat-one", "consumer", item);
  }
});

test("the first poll upgrades legacy pending requests without reading feedback", async (t) => {
  const { project, root, directory, backend, call, finish } = await setup(t);
  const canvas = await backend.open(project, "Legacy", "chat-one");
  await finish(canvas);
  await call(canvas, "/delivery", "POST", {});
  const index = join(directory, "claude-chats/chat-one");
  await rm(join(index, "pending"), { recursive: true });
  await atomicJson(join(index, `${canvas.sessionId}.json`), { root });
  await writeFile(join(index, "000-broken.json"), "{broken");
  // The immutable submission was validated by Send. Claiming needs metadata.
  await writeFile(
    join(sessionDir(root, canvas.sessionId), "feedback.json"),
    "{broken",
  );
  const item = await pollAgentDelivery(directory, "chat-one", "consumer");
  assert.equal(item.sessionId, canvas.sessionId);
  await settleAgentDelivery(directory, "chat-one", "consumer", item);
  assert.equal(
    await pollAgentDelivery(directory, "chat-one", "consumer"),
    null,
  );
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
