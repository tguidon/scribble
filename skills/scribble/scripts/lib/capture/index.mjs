import { WebCapture } from "./web.mjs";
import { SimulatorCapture } from "./simulator.mjs";
import {
  playwright,
  simCommand,
  setupCommand,
  ensureCapture,
} from "./runtime.mjs";
import { captureError } from "./common.mjs";

export function createCaptures(root, options = {}) {
  const sessions = new Map(),
    queues = new Map();
  let closed = false;
  const sources = (id) => {
    if (closed)
      throw captureError(
        "Scribble is stopping. Reconnect after it restarts.",
        503,
      );
    if (!sessions.has(id))
      sessions.set(id, {
        web: new WebCapture(root, options.web),
        simulator: new SimulatorCapture(root, options.simulator),
      });
    return sessions.get(id);
  };
  async function run(id, task) {
    const operation = (queues.get(id) || Promise.resolve()).then(() =>
      task(sources(id)),
    );
    const tail = operation
      .catch(() => {})
      .finally(() => {
        if (queues.get(id) === tail) queues.delete(id);
      });
    queues.set(id, tail);
    return operation;
  }
  return {
    async status(id) {
      const current = sources(id);
      let webAvailable = false,
        simulatorAvailable = false;
      try {
        playwright(root);
        webAvailable = true;
      } catch {}
      try {
        if (!options.simulator?.command) await simCommand(root);
        simulatorAvailable = true;
      } catch {}
      return {
        web: {
          available: webAvailable,
          ...current.web.state(),
          setupCommand: setupCommand(root, "web"),
        },
        simulator: {
          available: simulatorAvailable,
          supported: process.platform === "darwin" && process.arch === "arm64",
          ...current.simulator.state(),
          setupCommand: setupCommand(root, "simulator"),
        },
      };
    },
    devices: (id) => run(id, (s) => s.simulator.devices()),
    stream(id, kind, res, generation) {
      if (!["web", "simulator"].includes(kind))
        throw captureError("Choose a webpage or simulator.");
      return run(id, (s) => {
        if (
          generation !== null &&
          Number(generation) !== s[kind].state().generation
        )
          throw captureError(
            "The source changed. Reconnect the live view.",
            409,
          );
        return s[kind].stream(res);
      });
    },
    command(id, action, input) {
      if (!["web", "simulator"].includes(input?.kind))
        throw captureError("Choose a webpage or simulator.");
      return run(id, async (sources) => {
        const source = sources[input.kind];
        if (action === "open") {
          if (!(input.kind === "simulator" && options.simulator?.command))
            await ensureCapture(root, input.kind);
          return source.open(input);
        }
        if (action === "input") {
          if (
            input.generation !== undefined &&
            input.generation !== source.state().generation
          )
            throw captureError(
              "The source changed. Reconnect the live view.",
              409,
            );
          return source.input(input);
        }
        if (action === "focus" && input.kind === "web") return source.focus();
        if (action === "disconnect") {
          await source.close();
          return source.state();
        }
        if (action === "snapshot") return source.capture();
        throw captureError("Unknown capture action.");
      });
    },
    async close() {
      closed = true;
      await Promise.all([...queues.values()]);
      await Promise.allSettled(
        [...sessions.values()].flatMap((s) => [
          s.web.close(),
          s.simulator.close(),
        ]),
      );
      sessions.clear();
    },
  };
}
