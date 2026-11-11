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
    resolveSubmit,
    settle = async () => {};
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
    mcp: {
      call: async (server, tool, request) => {
        assert.equal(server, "plugin_scribble_scribble");
        if (tool === "settle_delivery") {
          settled.push(request);
          await settle(request);
          if (pending?.requestId === request.item.requestId)
            pending = undefined;
        } else assert.equal(tool, "poll_delivery");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                tool === "poll_delivery" ? { item: pending || null } : {},
              ),
            },
          ],
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
    onSettle(fn) {
      settle = fn;
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
  assert.equal(f.settled[0].error, true);
  await f.tick();
  assert.equal(f.submitted.length, 1);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("a late old-session receipt cannot overwrite a successor's accepted outcome", async () => {
  const f = await setup();
  const oldReceipt = deferred(),
    newReceipt = deferred();
  let attempts = 0;
  f.onSettle(({ chatId }) => {
    if (chatId === "chat-one") return oldReceipt.promise;
    if (++attempts === 1) return newReceipt.promise;
  });
  f.queue(item);
  await f.tick();
  f.accept();
  await flush();
  assert.equal(f.settled.length, 1);

  await f.fire("session.end");
  f.switchChat("chat-two");
  await f.fire("session.start");
  f.queue({ ...item, requestId: "request-two", sessionId: "canvas-two" });
  await f.tick();
  f.accept();
  await flush();
  assert.equal(f.settled.length, 2);
  assert.notEqual(f.settled[0].consumer, f.settled[1].consumer);

  oldReceipt.resolve();
  await flush();
  newReceipt.reject(new Error("receipt temporarily unavailable"));
  await flush();
  await f.tick();
  assert.equal(f.submitted.length, 2);
  assert.equal(f.settled.length, 3);
  assert.equal(f.settled[2].chatId, "chat-two");
  assert.equal(f.settled[2].error, false);
  assert.equal(f.settled[2].item.requestId, "request-two");
});

test("teardown during prompt submission leaves the next session independent", async () => {
  const f = await setup();
  f.queue(item);
  await f.tick();
  const acceptOld = f.accept;
  // Capture the actual old resolver before the next prompt replaces it.
  const oldSubmission = deferred();
  f.$.prompt.submit = () => oldSubmission.promise;
  await f.fire("session.end");
  acceptOld();
  await flush();
  assert.equal(f.settled.length, 0);
  f.switchChat("chat-two");
  await f.fire("turn.complete");
  f.queue({ ...item, requestId: "request-two" });
  await f.tick();
  oldSubmission.resolve({});
  await flush();
  assert.equal(f.settled.length, 1);
  assert.equal(f.settled[0].chatId, "chat-two");
});

test("failed receipt writes retry acceptance without sending another prompt", async () => {
  const f = await setup();
  let attempts = 0;
  f.onSettle(() => {
    if (++attempts < 3) throw new Error("disk unavailable");
  });
  f.queue(item);
  await f.tick();
  f.accept();
  await flush();
  await f.tick();
  await f.tick();
  assert.equal(f.submitted.length, 1);
  assert.equal(f.settled.length, 3);
  assert.ok(f.settled.every((request) => request.error === false));
});
