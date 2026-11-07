// The browser, plugin relay, and simulator snapshot reader consume the same
// bounded multipart format. This module has no Node or DOM dependencies.
export const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;

/** @param {ReadableStream<Uint8Array>} body */
export async function* readMultipartFrames(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw new Error("The live view disconnected. Reconnect to try again.");
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer);
      joined.set(value, buffer.length);
      buffer = joined;
      if (buffer.length > MAX_FRAME_BYTES + MAX_HEADER_BYTES)
        throw new Error("The live frame is too large. Reconnect to try again.");
      while (buffer.length) {
        let end = -1;
        for (
          let i = 0;
          i < Math.min(buffer.length - 3, MAX_HEADER_BYTES);
          i++
        ) {
          if (
            buffer[i] === 13 &&
            buffer[i + 1] === 10 &&
            buffer[i + 2] === 13 &&
            buffer[i + 3] === 10
          ) {
            end = i;
            break;
          }
        }
        if (end < 0) {
          if (buffer.length > MAX_HEADER_BYTES)
            throw new Error("Invalid live frame header.");
          break;
        }
        const length = Number(
          /content-length:\s*(\d+)/i.exec(
            decoder.decode(buffer.subarray(0, end)),
          )?.[1],
        );
        if (!Number.isInteger(length) || length < 1 || length > MAX_FRAME_BYTES)
          throw new Error("Invalid or oversized live frame length.");
        if (buffer.length < end + 4 + length) break;
        yield buffer.slice(end + 4, end + 4 + length);
        buffer = buffer.slice(end + 4 + length);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
