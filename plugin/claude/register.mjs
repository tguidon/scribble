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

export function register(on) {
  let controller;
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
    if (
      e.tool !== "mcp__plugin_scribble_scribble__open_canvas" &&
      e.tool !== "mcp__scribble__open_canvas"
    )
      return next(e);
    if (!controller) controller = start($);
    controller.server =
      e.tool === "mcp__scribble__open_canvas"
        ? "scribble"
        : "plugin_scribble_scribble";
    return next({ ...e, deliveryChatId: await $.session.id() });
  });
  on("turn.complete", ($, e, next) => {
    if (!e.agentId && !e.isAborted && !controller) controller = start($);
    return next(e);
  });
}
