export function captureError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function localUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw captureError(
      "Enter a full local URL, such as http://localhost:3000.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw captureError(
      "Use an HTTP or HTTPS URL on localhost, 127.0.0.1, or [::1].",
    );
  return url;
}
export function imageDimensions(bytes) {
  let width, height;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height || width * height > 40000000)
    throw captureError(
      "The captured image is invalid or exceeds 40 megapixels. Try a smaller viewport.",
    );
  if (bytes.length > 20 * 1024 * 1024)
    throw captureError(
      "The captured image exceeds 20 MB. Try a smaller viewport.",
    );
  return { width, height };
}
