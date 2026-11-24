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
    settled = [],
    bound = [];
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
        if (tool === "bind_delivery") bound.push(request);
        else if (tool === "settle_delivery") {
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
    bound,
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

test("mod hides its delivery control tools from the model and passes others through", async () => {
  const f = await setup();
  for (const server of ["plugin_scribble_scribble", "scribble"])
    for (const tool of ["bind_delivery", "poll_delivery", "settle_delivery"])
      assert.deepEqual(
        await f.fire("tool.offer", { tool: `mcp__${server}__${tool}` }, () =>
          assert.fail("control tools must not reach the model"),
        ),
        { isOffered: false },
      );
  for (const tool of [
    "mcp__plugin_scribble_scribble__open_canvas",
    "mcp__plugin_scribble_scribble__read_feedback",
    "mcp__other__poll_delivery",
  ])
    assert.deepEqual(
      await f.fire("tool.offer", { tool }, async () => ({ isOffered: true })),
      { isOffered: true },
    );
});

test("mod binds only Scribble launches and renews delivery while a prompt waits for idle", async () => {
  const f = await setup();
  const call = {
    tool: "mcp__plugin_scribble_scribble__open_canvas",
    projectPath: "/project",
  };
  const opened = {
    result: {},
    text: JSON.stringify({
      sessionId: "canvas-one",
      browserUrl: `http://127.0.0.1:1/#token=${"a".repeat(64)}&session=canvas-one`,
    }),
  };
  // Auto mode reviews the input as the model wrote it, so the mod must pass
  // the call through unchanged and return the tool's own outcome.
  assert.equal(
    await f.fire("tool.call", call, async (input) => {
      assert.equal(input, call);
      return opened;
    }),
    opened,
  );
  assert.deepEqual(f.bound, [
    {
      chatId: "chat-one",
      consumer: f.bound[0].consumer,
      sessionId: "canvas-one",
      token: "a".repeat(64),
    },
  ]);
  for (const outcome of [{ isError: true, text: "No project" }, { deny: "No" }])
    await f.fire("tool.call", call, async () => outcome);
  const other = { tool: "mcp__other__open_canvas" };
  assert.equal(
    await f.fire("tool.call", other, async (input) => input),
    other,
  );
  assert.equal(f.bound.length, 1);
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
