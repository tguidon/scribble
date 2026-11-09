import { test } from "node:test";
import assert from "node:assert/strict";

// Exercise the adapter against the documented API shape, without starting or
// authenticating Claude Code. Real host verification is a separate manual step.
async function setup() {
  const { register } = await import(
    `../plugin/claude/register.mjs?test=${Math.random()}`
  );
  const handlers = new Map();
  const submitted = [],
    settled = [];
  let timer,
    pending,
    messages = [],
    chatId = "chat-one",
    resolveSubmit;
  const $ = {
    plugin: { root: "/installed plugin" },
    session: { id: async () => chatId, messages: async () => messages },
    clock: {
      every: (ms, fn) => {
        assert.equal(ms, 1000);
        timer = fn;
        return {
          cancel() {
            timer = undefined;
          },
        };
      },
    },
    process: {
      run: async (args, options) => {
        assert.deepEqual(args, [
          "node",
          "/installed plugin/plugin/claude/delivery.mjs",
        ]);
        const request = JSON.parse(options.stdin);
        if (request.action === "settle") {
          settled.push(request);
          pending = undefined;
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            request.action === "poll" ? pending || null : null,
          ),
        };
      },
    },
    prompt: {
      submit: async (input) => {
        submitted.push(input);
        return new Promise((resolve) => {
          resolveSubmit = resolve;
        });
      },
    },
    ui: { toast: () => {} },
  };
  register((event, fn) => handlers.set(event, fn));
  const fire = (event, e = {}, next = async (value) => value) =>
    handlers.get(event)($, e, next);
  await fire("session.start");
  const tick = async () => {
    await timer?.();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    $,
    fire,
    tick,
    submitted,
    settled,
    queue(value) {
      pending = value;
    },
    accept(result = {}) {
      resolveSubmit(result);
    },
    history(value) {
      messages = value;
    },
    switchChat(value) {
      chatId = value;
    },
  };
}
const item = {
  sessionId: "canvas-one",
  requestId: "request-one",
  marker: "Scribble canvas: canvas-one",
  text: "Apply feedback\n\nScribble canvas: canvas-one",
};

test("mod binds only Scribble launches and renews delivery while a prompt waits for idle", async () => {
  const f = await setup();
  assert.equal(
    (
      await f.fire("tool.call", {
        tool: "mcp__plugin_scribble_scribble__open_canvas",
        projectPath: "/project",
      })
    ).deliveryChatId,
    "chat-one",
  );
  assert.equal(
    (await f.fire("tool.call", { tool: "mcp__other__open_canvas" }))
      .deliveryChatId,
    undefined,
  );
  f.queue(item);
  await f.tick();
  assert.equal(f.submitted.length, 1);
  assert.equal(f.settled.length, 0);
  await f.tick();
  assert.equal(f.submitted.length, 1);
  f.accept();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.settled.length, 1);
  assert.equal(f.settled[0].chatId, "chat-one");
});

test("mod reconciles accepted prompts from transcript and respects chat teardown", async () => {
  const f = await setup();
  f.queue(item);
  f.history([{ role: "user", text: item.text }]);
  await f.tick();
  assert.equal(f.submitted.length, 0);
  assert.equal(f.settled.length, 1);
  await f.fire("session.end", { reason: "clear" });
  f.switchChat("chat-two");
  f.queue({ ...item, sessionId: "old-canvas" });
  await f.tick();
  assert.equal(f.submitted.length, 0);
});

test("mod records a dropped prompt as paused instead of repeatedly resubmitting it", async () => {
  const f = await setup();
  f.queue(item);
  await f.tick();
  f.accept({ drop: "the session was stopped and nobody has sent input since" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(f.settled[0].error, /stopped/);
  await f.tick();
  assert.equal(f.submitted.length, 1);
});
