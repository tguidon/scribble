// Bounded MJPEG parsing works in WebKit when transported as octet-stream.
export async function readLiveFrames(
  response: Response,
  onFrame: (bytes: Uint8Array) => void,
) {
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || "The live view disconnected. Reconnect to try again.",
    );
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        throw new Error("The live view disconnected. Reconnect to try again.");
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer);
      joined.set(value, buffer.length);
      buffer = joined;
      if (buffer.length > 21 * 1024 * 1024)
        throw new Error("The live frame is too large. Reconnect to try again.");
      while (buffer.length) {
        let end = -1;
        for (let i = 0; i < Math.min(buffer.length - 3, 8192); i++) {
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
          if (buffer.length > 8192)
            throw new Error(
              "Invalid live stream header. Reconnect to try again.",
            );
          break;
        }
        const length = Number(
          /content-length:\s*(\d+)/i.exec(
            decoder.decode(buffer.subarray(0, end)),
          )?.[1],
        );
        if (!length || length > 20 * 1024 * 1024)
          throw new Error("Invalid live frame. Reconnect to try again.");
        if (buffer.length < end + 4 + length) break;
        onFrame(buffer.slice(end + 4, end + 4 + length));
        buffer = buffer.slice(end + 4 + length);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
