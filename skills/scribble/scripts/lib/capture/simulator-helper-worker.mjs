import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";

// The embedding API lazily attaches to a booted device without the CLI's
// host-app launch. Keep its native capture code out of Scribble's server.
const [entry, device] = process.argv.slice(2);
process.on("disconnect", () => process.exit());
const { simMiddleware } = createRequire(import.meta.url)(entry);
const middleware = simMiddleware({ basePath: "/", device });
const prefix = `/helper/${device}`;
const reads = new Set(
  ["config", "foreground", "stream.mjpeg"].map((path) => `${prefix}/${path}`),
);
const local = (req) =>
  req.headers.host === `127.0.0.1:${server.address().port}` &&
  !req.headers.origin;
const server = createServer((req, res) => {
  if (!local(req) || req.method !== "GET" || !reads.has(req.url)) {
    res.writeHead(404).end();
    return;
  }
  void middleware(req, res).catch(() => {
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end();
  });
});
server.on("upgrade", (req, socket, head) => {
  if (local(req) && req.url === `${prefix}/ws`)
    middleware.handleUpgrade(req, socket, head);
  else socket.destroy();
});
server.listen(0, "127.0.0.1", () => {
  process.send(server.address().port);
  const checkBooted = () => {
    execFile(
      "xcrun",
      ["simctl", "list", "devices", "booted", "-j"],
      { timeout: 4000 },
      (error, stdout) => {
        if (!error) {
          let devices;
          try {
            devices = Object.values(JSON.parse(stdout).devices).flat();
          } catch {}
          if (
            devices &&
            !devices.some(
              (item) => item.udid === device && item.state === "Booted",
            )
          )
            process.exit();
        }
        setTimeout(checkBooted, 5000).unref();
      },
    );
  };
  setTimeout(checkBooted, 5000).unref();
});
