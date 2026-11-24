// Every callback holds its own controller. Disposing it cannot clear a later
// session's prompt result, even when an old MCP call completes out of order.
function start($) {
  const controller = {
    consumer: `mod-${Math.random().toString(36).slice(2)}`,
    server: "plugin_scribble_scribble",
    chatId: undefined,
    disposed: false,
    polling: false,
    work: null,
    lastError: undefined,
  };
  controller.timer = $.clock.every(1000, () => tick($, controller));
  return controller;
}

function dispose(controller) {
  if (!controller) return;
  controller.disposed = true;
  controller.timer.cancel();
}

function report($, controller, error) {
  if (controller.disposed || controller.lastError === error.message) return;
  controller.lastError = error.message;
  try {
    $.ui.toast(`Scribble: ${error.message || "delivery unavailable"}`);
  } catch {
    // A missing UI surface cannot discard the stored prompt outcome.
  }
}

async function active($, controller) {
  const chatId = await $.session.id();
  return !controller.disposed && chatId === controller.chatId;
}

async function call($, controller, tool, args = {}) {
  const result = await $.mcp.call(controller.server, tool, {
    chatId: controller.chatId,
    consumer: controller.consumer,
    ...args,
  });
  const text = result.content.find((block) => block.type === "text")?.text;
  if (result.isError) throw new Error(text || "Delivery unavailable.");
  return JSON.parse(text);
}

async function settle($, controller) {
  const work = controller.work;
  if (work?.phase !== "settling" || work.saving) return;
  work.saving = true;
  try {
    await call($, controller, "settle_delivery", {
      item: { sessionId: work.item.sessionId, requestId: work.item.requestId },
      error: work.error,
    });
    if (!controller.disposed && controller.work === work)
      controller.work = null;
  } catch (error) {
    // Preserve the known prompt outcome until its receipt is saved. A failed
    // acknowledgement must never turn acceptance into a pause or resubmission.
    report($, controller, error);
  } finally {
    work.saving = false;
  }
}

async function deliver($, controller, item) {
  controller.work = { phase: "submitting", item };
  let error = false;
  try {
    // Reconcile a restart between prompt acceptance and its durable receipt.
    const messages = await $.session.messages();
    const alreadySent = messages.some(
      (message) =>
        message.role === "user" && message.text?.includes(item.marker),
    );
    if (!(await active($, controller))) return;
    const result = alreadySent
      ? {}
      : await $.prompt.submit({ text: item.text });
    error = !!result?.drop;
  } catch (cause) {
    error = true;
    report($, controller, cause);
  }
  // Acceptance is already known. Do not put another fallible host call between
  // that outcome and retaining it for receipt retries.
  if (controller.disposed) return;
  controller.work = { phase: "settling", item, error, saving: false };
  await settle($, controller);
}

async function tick($, controller) {
  if (controller.disposed || controller.polling) return;
  controller.polling = true;
  try {
    const chatId = await $.session.id();
    if (controller.disposed) return;
    controller.chatId ??= chatId;
    if (chatId !== controller.chatId) return;
    await settle($, controller);
    if (controller.disposed) return;
    // Renew the lease even while prompt.submit is waiting for an idle session.
    const { item } = await call($, controller, "poll_delivery");
    if (controller.disposed || !item || controller.work) return;
    if ((await $.session.id()) !== controller.chatId || controller.disposed)
      return;
    controller.lastError = undefined;
    void deliver($, controller, item);
  } catch (error) {
    report($, controller, error);
  } finally {
    controller.polling = false;
  }
}

// The delivery control tools must stay in the session's tool pool so that
// `$.mcp.call` can reach them. Keep them away from every model loop instead.
const SERVERS = ["plugin_scribble_scribble", "scribble"];
const CONTROL_TOOLS = new Set(
  SERVERS.flatMap((server) =>
    ["bind_delivery", "poll_delivery", "settle_delivery"].map(
      (tool) => `mcp__${server}__${tool}`,
    ),
  ),
);
const OPEN_TOOLS = new Map(
  SERVERS.map((server) => [`mcp__${server}__open_canvas`, server]),
);

// Link a canvas to this chat once open_canvas has answered. The canvas token
// is in the browser URL that the tool returned to the model.
async function bind($, controller, outcome) {
  if (!outcome || outcome.isError || outcome.deny || !outcome.text) return;
  try {
    const { sessionId, browserUrl } = JSON.parse(outcome.text);
    const token = new URLSearchParams(new URL(browserUrl).hash.slice(1)).get(
      "token",
    );
    await call($, controller, "bind_delivery", {
      chatId: await $.session.id(),
      sessionId,
      token,
    });
  } catch (error) {
    // The canvas still opens. Without a link, Send offers the copied handoff.
    report($, controller, error);
  }
}

export function register(on) {
  let controller;
  on("tool.offer", ($, e, next) =>
    CONTROL_TOOLS.has(e.tool) ? { isOffered: false } : next(e),
  );
  on("session.start", ($, e, next) => {
    dispose(controller);
    controller = start($);
    return next(e);
  });
  on("session.end", ($, e, next) => {
    dispose(controller);
    controller = undefined;
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    const server = OPEN_TOOLS.get(e.tool);
    if (!server) return next(e);
    if (!controller) controller = start($);
    controller.server = server;
    // Never rewrite this input. Auto mode reviews the call as the model wrote
    // it, and a changed input leaves that review without a verdict.
    const outcome = await next(e);
    await bind($, controller, outcome);
    return outcome;
  });
  on("turn.complete", ($, e, next) => {
    if (!e.agentId && !e.isAborted && !controller) controller = start($);
    return next(e);
  });
}
