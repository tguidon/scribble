import { captureError } from "./common.mjs";

export function validateInput(input) {
  const finite = (v, max) => Number.isFinite(v) && Math.abs(v) <= max;
  if (input.type === "pointer") {
    if (
      !["down", "move", "up"].includes(input.phase) ||
      ![input.x, input.y].every((v) => finite(v, 1) && v >= 0)
    )
      throw captureError("Invalid screen coordinates.");
  } else if (input.type === "wheel") {
    if (![input.dx, input.dy].every((v) => finite(v, 2000)))
      throw captureError("Invalid scroll distance.");
  } else if (input.type === "key") {
    if (
      typeof input.key !== "string" ||
      input.key.length > 30 ||
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
  } else if (input.type === "text") {
    if (typeof input.text !== "string" || input.text.length > 4000)
      throw captureError("Paste up to 4,000 characters at a time.");
  } else if (!["release", "back", "reload", "home"].includes(input.type)) {
    throw captureError("Unknown live view action.");
  }
  return input;
}

export function streamHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
}
export function writeFrame(res, bytes) {
  if (res.destroyed || res.writableLength > 1024 * 1024) return;
  res.write(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`,
  );
  res.write(bytes);
  res.write("\r\n");
}
