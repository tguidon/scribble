import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { alive } from "./lock.mjs";
import { readJson } from "./store.mjs";
import { SERVER_PROTOCOL } from "./version.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connection(info) {
  const url = new URL(info.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
    throw new Error(
      "Invalid recorded server URL. Expected a local Scribble server.",
    );
  const params = new URLSearchParams(url.hash.slice(1));
  return {
    origin: url.origin,
    headers: {
      Authorization: `Bearer ${params.get("token")}`,
      "X-Scribble-Session": info.sessionId,
    },
  };
}

export async function serverHealth(info) {
  const { origin, headers } = connection(info);
  const response = await fetch(`${origin}/api/health`, {
    headers,
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  const health = response?.ok ? await response.json().catch(() => null) : null;
  if (
    !health ||
    health.pid !== info.pid ||
    (info.instanceId && health.instanceId !== info.instanceId)
  )
    throw new Error(
      `The recorded Scribble process (PID ${info.pid}) is still running but did not pass its health check. Retry shortly, or inspect and stop that process before restarting Scribble on port ${new URL(info.url).port}.`,
    );
  return health;
}

export async function stopServer(root, info) {
  if (!info || !alive(info.pid))
    return { stopped: false, alreadyStopped: true };
  const health = await serverHealth(info);
  if (!health.instanceId || health.protocol !== SERVER_PROTOCOL)
    throw new Error(
      `This older server does not support safe shutdown. Save your browser draft, inspect PID ${info.pid}, and stop it with your process manager. Then run Scribble again.`,
    );
  const { origin, headers } = connection(info);
  const response = await fetch(`${origin}/api/shutdown`, {
    method: "POST",
    headers: { ...headers, "X-Scribble-Instance": health.instanceId },
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok)
    throw new Error(
      "The server declined shutdown. Saved feedback is unchanged.",
    );
  for (let attempt = 0; attempt < 100; attempt++) {
    const owner = await readFile(
      join(root, "server-owner.lock/owner"),
      "utf8",
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!owner || !owner.startsWith(`${info.pid}:`)) {
      const recorded = await readJson(join(root, "server.json")).catch(
        () => null,
      );
      if (recorded?.instanceId === health.instanceId)
        await rm(join(root, "server.json"), { force: true });
      return { stopped: true, pid: info.pid, version: health.version };
    }
    await delay(100);
  }
  throw new Error(
    "The server is still finishing active requests. Retry stop shortly; no replacement server was started.",
  );
}
