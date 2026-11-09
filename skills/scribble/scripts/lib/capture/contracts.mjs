import { captureError } from "./common.mjs";

/** @typedef {"web" | "simulator"} CaptureKind */
/** @typedef {{width: number, height: number}} Viewport */
/** @typedef {{id: string, name: string}} SimulatorDevice */
/** @typedef {{control?: boolean, meta?: boolean, shift?: boolean, alt?: boolean}} Modifiers */
/** @typedef {{type: "pointer", phase: "down" | "move" | "up", x: number, y: number}
 * | {type: "wheel", dx: number, dy: number}
 * | ({type: "key", key: string} & Modifiers)
 * | {type: "text", text: string}
 * | {type: "release" | "back" | "reload" | "home"}} CaptureInput */
/** @typedef {{kind: "web"} & ({connected: false} | {connected: true, generation: number, url: string, viewport: Viewport})} WebConnection */
/** @typedef {{kind: "simulator"} & ({connected: false} | {connected: true, generation: number, device: SimulatorDevice, previewUrl: string, inputWarning?: string})} SimulatorConnection */
/** @typedef {{available: boolean, setupCommand: string}} Availability */
/** @typedef {{web: WebConnection & Availability, simulator: SimulatorConnection & Availability & {supported: boolean}}} CaptureStatus */
/** @typedef {{kind: "web", fullPage?: boolean} | {kind: "simulator"}} CaptureSnapshot */
/** @typedef {({action: "open", kind: "web", url: string} & Viewport)
 * | {action: "open", kind: "simulator", deviceId: string}
 * | ({action: "resize", kind: "web", generation: number} & Viewport)
 * | ({action: "input", kind: CaptureKind, generation: number} & CaptureInput)
 * | {action: "focus", kind: "web"}
 * | {action: "disconnect", kind: CaptureKind}
 * | ({action: "snapshot"} & CaptureSnapshot)} CaptureCommand */

/** @param {Viewport} size @returns {Viewport} */
export function viewportSize({ width, height }) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 320 && n <= 2560)
  )
    throw captureError(
      "Choose viewport dimensions between 320 and 2560 pixels.",
    );
  return { width, height };
}

/** @param {unknown} input @returns {CaptureInput} */
export function validateInput(input) {
  if (!input || typeof input !== "object")
    throw captureError("Expected a live view action.");
  const finite = (value, max) =>
    Number.isFinite(value) && Math.abs(value) <= max;
  switch (input.type) {
    case "pointer":
      if (
        !["down", "move", "up"].includes(input.phase) ||
        ![input.x, input.y].every((v) => finite(v, 1) && v >= 0)
      )
        throw captureError("Invalid screen coordinates.");
      return { type: "pointer", phase: input.phase, x: input.x, y: input.y };
    case "wheel":
      if (![input.dx, input.dy].every((v) => finite(v, 2000)))
        throw captureError("Invalid scroll distance.");
      return { type: "wheel", dx: input.dx, dy: input.dy };
    case "key": {
      if (
        typeof input.key !== "string" ||
        !(
          input.key.length === 1 ||
          [
            "Enter",
            "Backspace",
            "Delete",
            "Tab",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(input.key)
        )
      )
        throw captureError("This key is not supported in the live view.");
      for (const key of ["control", "meta", "shift", "alt"])
        if (input[key] !== undefined && typeof input[key] !== "boolean")
          throw captureError("Invalid keyboard modifier.");
      return {
        type: "key",
        key: input.key,
        control: input.control === true,
        meta: input.meta === true,
        shift: input.shift === true,
        alt: input.alt === true,
      };
    }
    case "text":
      if (typeof input.text !== "string" || input.text.length > 4000)
        throw captureError("Paste up to 4,000 characters at a time.");
      return { type: "text", text: input.text };
    case "release":
    case "back":
    case "reload":
    case "home":
      return { type: input.type };
    default:
      throw captureError("Unknown live view action.");
  }
}

/** @param {string} action @param {unknown} input @returns {CaptureCommand} */
export function validateCaptureCommand(action, input) {
  if (
    !input ||
    typeof input !== "object" ||
    !["web", "simulator"].includes(input.kind)
  )
    throw captureError("Choose a webpage or simulator.");
  const kind = input.kind;
  switch (action) {
    case "open":
      if (kind === "web") {
        if (typeof input.url !== "string")
          throw captureError("Enter a webpage URL.");
        return {
          action,
          kind,
          url: input.url,
          ...viewportSize({
            width: input.width ?? 1280,
            height: input.height ?? 900,
          }),
        };
      }
      if (
        typeof input.deviceId !== "string" ||
        !/^[a-f\d-]{36}$/i.test(input.deviceId)
      )
        throw captureError("Choose a booted simulator.");
      return { action, kind, deviceId: input.deviceId };
    case "resize":
      if (kind !== "web")
        throw captureError("Viewport resizing is only available for webpages.");
      return {
        action,
        kind,
        generation: generation(input.generation),
        ...viewportSize(input),
      };
    case "input": {
      const event = validateInput(input);
      if (
        (kind === "web" && event.type === "home") ||
        (kind === "simulator" && ["back", "reload"].includes(event.type))
      )
        throw captureError("This action is not available for this source.");
      return {
        action,
        kind,
        generation: generation(input.generation),
        ...event,
      };
    }
    case "focus":
      if (kind !== "web") throw captureError("Only webpages can be focused.");
      return { action, kind };
    case "disconnect":
      return { action, kind };
    case "snapshot":
      if (input.fullPage !== undefined && typeof input.fullPage !== "boolean")
        throw captureError("Choose a valid full-page capture option.");
      if (kind === "simulator") {
        if (input.fullPage !== undefined)
          throw captureError(
            "Full-page capture is only available for webpages.",
          );
        return { action, kind };
      }
      return { action, kind, fullPage: input.fullPage === true };
    default:
      throw captureError("Unknown capture action.");
  }
}
function generation(value) {
  if (!Number.isInteger(value) || value < 0)
    throw captureError("A live source generation is required.");
  return value;
}
