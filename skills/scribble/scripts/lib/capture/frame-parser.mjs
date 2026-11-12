// The browser, plugin relay, and simulator snapshot reader consume the same
// bounded multipart format. This module has no Node or DOM dependencies.
export const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;

/** @param {ReadableStream<Uint8Array>} body */
export async function* readMultipartFrames(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const header = new Uint8Array(MAX_HEADER_BYTES);
  let headerSize = 0;
  let frame;
  let filled = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw new Error("The live view disconnected. Reconnect to try again.");
      let offset = 0;
      while (offset < value.length) {
        if (!frame) {
          header[headerSize++] = value[offset++];
          if (
            headerSize < 4 ||
            header[headerSize - 4] !== 13 ||
            header[headerSize - 3] !== 10 ||
            header[headerSize - 2] !== 13 ||
            header[headerSize - 1] !== 10
          ) {
            if (headerSize === header.length)
              throw new Error("Invalid live frame header.");
            continue;
          }
          const length = Number(
            /content-length:\s*(\d+)/i.exec(
              decoder.decode(header.subarray(0, headerSize)),
            )?.[1],
          );
          if (
            !Number.isInteger(length) ||
            length < 1 ||
            length > MAX_FRAME_BYTES
          )
            throw new Error("Invalid or oversized live frame length.");
          frame = new Uint8Array(length);
          filled = 0;
          headerSize = 0;
        }
        // Copy each chunk once, even for multi-megabyte lossless frames.
        const count = Math.min(value.length - offset, frame.length - filled);
        frame.set(value.subarray(offset, offset + count), filled);
        offset += count;
        filled += count;
        if (filled === frame.length) {
          yield frame;
          frame = undefined;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
