import { validateCaptureCommand } from "./contracts.mjs";
import { WebCapture } from "./web.mjs";
import { SimulatorCapture } from "./simulator.mjs";
import { SimulatorHelpers } from "./simulator-helper.mjs";
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
  const helpers = new SimulatorHelpers(root);
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
        simulator: new SimulatorCapture(root, {
          helpers,
          ...options.simulator,
        }),
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
    resumeSource(id, imageSource) {
      if (imageSource?.kind === "shared") return { kind: "shared" };
      const current = sessions.get(id);
      const web = current?.web.state();
      const simulator = current?.simulator.state();
      if (
        web?.connected &&
        (imageSource?.kind === "web" || !simulator?.connected)
      )
        return { kind: "web", url: web.url, viewport: web.viewport };
      if (simulator?.connected)
        return { kind: "simulator", deviceId: simulator.device.id };
      if (imageSource?.kind === "web")
        return {
          kind: "web",
          url: imageSource.url,
          viewport: imageSource.viewport,
        };
      if (imageSource?.kind === "simulator")
        return { kind: "simulator", deviceId: imageSource.device.id };
    },
    async transfer(id, nextId, kind) {
      return run(id, async (current) => {
        const source = current[kind];
        if (!source.state().connected) return false;
        await source.stopStream?.();
        await source.release();
        await current[kind === "web" ? "simulator" : "web"].close();
        sources(nextId)[kind] = source;
        sessions.delete(id);
        return true;
      });
    },
    /** @returns {Promise<import("./contracts.mjs").CaptureStatus>} */
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
      input = validateCaptureCommand(action, input);
      return run(id, async (sources) => {
        const source = sources[input.kind];
        switch (input.action) {
          case "open":
            if (!(input.kind === "simulator" && options.simulator?.command))
              await ensureCapture(root, input.kind);
            return source.open(input);
          case "input":
          case "resize":
            if (input.generation !== source.state().generation)
              throw captureError(
                "The source changed. Reconnect the live view.",
                409,
              );
            return input.action === "input"
              ? source.input(input)
              : source.resize(input);
          case "focus":
            return source.focus();
          case "disconnect":
            await source.close();
            return source.state();
          case "snapshot":
            return source.capture(input);
        }
      });
    },
    async release(id) {
      if (!sessions.has(id)) return;
      await run(id, async (sources) => {
        await Promise.all([sources.web.close(), sources.simulator.close()]);
        sessions.delete(id);
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
      await helpers.close();
    },
  };
}
