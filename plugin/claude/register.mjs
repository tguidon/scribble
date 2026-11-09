let timer;
let generation = 0;
let polling = false;
let inFlight;
let completed;
let paused = false;
const consumer = `mod-${Math.random().toString(36).slice(2)}`;

async function helper($, payload) {
  const result = await $.process.run(
    ["node", `${$.plugin.root}/plugin/claude/delivery.mjs`],
    {
      stdin: JSON.stringify(payload),
      timeoutMs: 10000,
    },
  );
  if (result.exitCode !== 0)
    throw new Error(result.stderr || "Scribble delivery is unavailable.");
  return JSON.parse(result.stdout);
}

async function deliver($, chatId, item, epoch) {
  inFlight = item;
  try {
    // Reconcile a crash after prompt acceptance but before its disk receipt.
    const messages = await $.session.messages();
    const alreadySent = messages.some(
      (message) =>
        message.role === "user" && message.text?.includes(item.marker),
    );
    if (epoch !== generation || (await $.session.id()) !== chatId) return;
    const result = alreadySent
      ? {}
      : await $.prompt.submit({ text: item.text });
    const error = result?.drop;
    if (epoch !== generation || (await $.session.id()) !== chatId) return;
    // Keep a successful result in memory while receipt writes retry. Never
    // resubmit a prompt merely because the acknowledgement couldn't be saved.
    completed = { chatId, item, error };
    if (error) paused = item.requestId;
    await helper($, { action: "settle", chatId, consumer, item, error });
    completed = undefined;
  } catch (error) {
    if (epoch === generation) {
      if (!completed) {
        paused = item.requestId;
        completed = { chatId, item, error: true };
      }
      try {
        $.ui.toast(`Scribble: ${error.message || "delivery paused"}`);
      } catch {
        // A missing UI surface must not discard a saved delivery request.
      }
    }
  } finally {
    if (epoch === generation) inFlight = undefined;
  }
}

async function tick($) {
  if (polling) return;
  polling = true;
  const epoch = generation;
  try {
    const chatId = await $.session.id();
    if (completed) {
      await helper($, { action: "settle", consumer, ...completed });
      completed = undefined;
    }
    // Keep the consumer lease alive even while a submitted prompt waits for
    // Claude to become idle. No model requests are made by this timer.
    const item = await helper($, { action: "poll", chatId, consumer });
    if (epoch !== generation || !item || inFlight || paused === item.requestId)
      return;
    if ((await $.session.id()) !== chatId) return;
    void deliver($, chatId, item, epoch);
  } catch {
    // A missing Node runtime or a transient lock/IO failure must not prevent
    // the host session from starting. Saved requests remain on disk.
  } finally {
    polling = false;
  }
}

function start($) {
  timer?.cancel();
  timer = $.clock.every(1000, () => tick($));
}

export function register(on) {
  on("session.start", ($, e, next) => {
    start($);
    return next(e);
  });
  on("session.end", ($, e, next) => {
    generation++;
    timer?.cancel();
    timer = undefined;
    inFlight = undefined;
    completed = undefined;
    paused = false;
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    // Match only Scribble's own MCP tool. All tool behavior stays in the
    // shared MCP server; the mod supplies its private chat routing context.
    if (
      e.tool !== "mcp__plugin_scribble_scribble__open_canvas" &&
      e.tool !== "mcp__scribble__open_canvas"
    )
      return next(e);
    if (!timer) start($);
    paused = false;
    return next({ ...e, deliveryChatId: await $.session.id() });
  });
  on("turn.complete", ($, e, next) => {
    if (!e.agentId && !e.isAborted) {
      paused = false;
      if (!timer) start($);
    }
    return next(e);
  });
}
