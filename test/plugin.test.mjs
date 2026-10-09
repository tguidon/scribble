import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPlugin } from "../plugin/mcp.mjs";
import { PluginBackend } from "../plugin/backend.mjs";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import { VERSION } from "../skills/scribble/scripts/lib/version.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
test("MCP canvas isolation, feedback delivery, original images, and new rounds", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "scribble-plugin-"));
  const root = join(project, ".scribble");
  const http = await startServer({ root, session: await createSession(root) });
  const directory = join(project, "registry");
  const plugin = createPlugin({ directory });
  const client = new Client({ name: "test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await plugin.server.connect(back);
  await client.connect(front);
  t.after(async () => {
    await client.close();
    await plugin.close();
    await http.close();
    await rm(project, { recursive: true, force: true });
  });
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.find((t) => t.name === "editor_request")._meta.ui.visibility,
    ["app"],
  );
  const resource = await client.readResource({
    uri: "ui://scribble/editor.html",
  });
  assert.match(resource.contents[0].text, /<html/);
  const open = () =>
    client.callTool({
      name: "open_canvas",
      arguments: { projectPath: project },
    });
  const first = await open(),
    second = await open();
  assert.ok(!first.isError, JSON.stringify(first));
  const one = first._meta.scribble,
    two = second._meta.scribble;
  assert.notEqual(one.sessionId, two.sessionId);
  const api = async (auth, path, method = "GET", data, binary = false) => {
    const response = await client.callTool({
      name: "editor_request",
      arguments: {
        sessionId: auth.sessionId,
        token: auth.token,
        path,
        method,
        data,
        binary,
      },
    });
    assert.ok(!response.isError, JSON.stringify(response));
    const wire = response._meta.scribble;
    return {
      status: wire.status,
      data: JSON.parse(Buffer.from(wire.body, "base64").toString()),
    };
  };
  const unauthorized = await client.callTool({
    name: "editor_request",
    arguments: { sessionId: two.sessionId, token: one.token, path: "/session" },
  });
  assert.equal(unauthorized.isError, true);
  for (const path of [
    "/shutdown",
    "http://example.com/session",
    "//example.com/session",
    "/../../etc/passwd",
  ]) {
    const rejected = await client.callTool({
      name: "editor_request",
      arguments: { sessionId: one.sessionId, token: one.token, path },
    });
    assert.equal(rejected.isError, true, path);
  }
  const upload = await api(
    one,
    "/images?width=1&height=1&name=proof.png",
    "POST",
    png,
    true,
  );
  assert.equal(upload.status, 201);
  const unfinished = await client.callTool({
    name: "read_image",
    arguments: { sessionId: one.sessionId, imageId: upload.data.images[0].id },
  });
  assert.equal(unfinished.isError, true);
  const saved = await api(
    one,
    "/draft",
    "PUT",
    JSON.stringify({
      ...upload.data,
      message: "Make this readable",
      saveId: "save-1",
    }),
  );
  assert.equal(saved.status, 200);
  assert.equal((await api(two, "/session")).data.images.length, 0);
  assert.equal(
    (
      await api(
        one,
        "/submit",
        "POST",
        JSON.stringify({ revision: saved.data.revision }),
      )
    ).status,
    200,
  );
  const pending = await client.callTool({
    name: "delivery_status",
    arguments: { sessionId: one.sessionId, token: one.token },
  });
  assert.equal(pending._meta.scribble.readAt, null);
  const feedback = await client.callTool({
    name: "read_feedback",
    arguments: { sessionId: one.sessionId },
  });
  assert.match(feedback.content[0].text, /Make this readable/);
  const original = await client.callTool({
    name: "read_image",
    arguments: { sessionId: one.sessionId, imageId: upload.data.images[0].id },
  });
  assert.equal(original.content[0].data, png);
  const received = await client.callTool({
    name: "delivery_status",
    arguments: { sessionId: one.sessionId, token: one.token },
  });
  assert.ok(received._meta.scribble.readAt);
  const next = await api(one, "/sessions", "POST", "{}");
  const retry = await api(one, "/sessions", "POST", "{}");
  assert.equal(next.data.url, retry.data.url);
  const params = new URLSearchParams(
    new URL(next.data.url, http.url).hash.slice(1),
  );
  const fresh = {
    sessionId: params.get("session"),
    token: params.get("token"),
  };
  assert.equal((await api(fresh, "/session")).data.images.length, 0);
  // Reconnecting MCP retains the exact previous canvas and read receipt.
  const reconnected = new PluginBackend({ directory });
  assert.match(
    (await reconnected.feedback(one.sessionId)).brief,
    /Make this readable/,
  );
  assert.equal(
    (await reconnected.delivery(two.sessionId, two.token)).readAt,
    null,
  );
});

test("bundled plugin starts over stdio without node_modules or source checkout", async (t) => {
  const destination = await mkdtemp(join(tmpdir(), "scribble-distribution-"));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await cp(resolve("plugin"), join(destination, "plugin"), { recursive: true });
  await cp(resolve("skills"), join(destination, "skills"), { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(destination, "plugin/mcp.mjs")],
    stderr: "pipe",
    env: { SCRIBBLE_PLUGIN_DATA: join(destination, "data") },
  });
  const client = new Client({ name: "distribution-test", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => client.close());
  await client.connect(transport).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });
  assert.ok(
    (await client.listTools()).tools.some(
      (tool) => tool.name === "open_canvas",
    ),
  );
  const html = await client.readResource({ uri: "ui://scribble/editor.html" });
  assert.ok(html.contents[0].text.length > 10000);
  assert.equal(
    JSON.parse(
      await readFile(join(destination, "skills/scribble/version.json"), "utf8"),
    ).version,
    VERSION,
  );
  for (const path of [
    "plugin.json",
    ".codex-plugin/plugin.json",
    "package.json",
  ])
    assert.equal(JSON.parse(await readFile(path, "utf8")).version, VERSION);
});
