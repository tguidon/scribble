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
