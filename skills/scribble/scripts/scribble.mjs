#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, access } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { withStartLock } from "./lib/lock.mjs";
import { spawn } from "node:child_process";
import {
  createSession,
  latestSession,
  loadSession,
  readJson,
  sessionDir,
  atomicJson,
} from "./lib/store.mjs";
import { startServer } from "./lib/app.mjs";
const cli = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(cli), "..");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    session: { type: "string" },
    port: { type: "string" },
    title: { type: "string" },
    target: { type: "string" },
    child: { type: "boolean" },
    dev: { type: "boolean" },
    detach: { type: "boolean" },
    "no-open": { type: "boolean" },
    new: { type: "boolean" },
    help: { type: "boolean" },
    timeout: { type: "string" },
  },
});
const command = positionals[0] || "start";
const root = resolve(values.dir || join(process.cwd(), ".scribble"));
async function selected() {
  const session = values.session
    ? await loadSession(root, values.session)
    : await latestSession(root);
  if (!session)
    throw new Error("No feedback session found. Run scribble start first.");
  return session;
}
function openBrowser(url) {
  const [program, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(program, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
async function main() {
  if (values.help || command === "help") {
    console.log(
      `Scribble — show your agent what you mean.\n\n  scribble start [--detach] [--no-open] [--new] [--session ID]\n  scribble wait [--session ID] [--timeout SECONDS]\n  scribble feedback [--session ID]\n  scribble status\n\nOptions: --dir PATH (default .scribble in this project), --port NUMBER, --title TEXT\nUse npm run build before starting. Install with npx skills add <repository> --skill scribble.\nDrafts and submitted bundles remain on disk when the server stops.`,
    );
    return;
  }
  if (command === "status") {
    const session = await latestSession(root);
    const server = await readJson(join(root, "server.json")).catch(() => null);
    print({
      session: session
        ? {
            id: session.id,
            status: session.status,
            images: session.images.length,
            updatedAt: session.updatedAt,
          }
        : null,
      server: server && alive(server.pid) ? server : null,
    });
    return;
  }
  if (command === "wait" || command === "feedback") {
    const session = await selected();
    const path = join(sessionDir(root, session.id), "feedback.json");
    const timeout =
      values.timeout === undefined ? 3600 : Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout < 0)
      throw new Error("Timeout must be a nonnegative number of seconds.");
    const start = Date.now();
    while (true) {
      try {
        print({ bundlePath: path, feedback: await readJson(path) });
        return;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (command === "feedback")
        throw new Error("Feedback has not been sent yet. Use scribble wait.");
      if (Date.now() - start >= timeout * 1000) {
        console.error(
          `Still waiting. Draft preserved. Resume with: node "${cli}" wait --dir "${root}" --session ${session.id}`,
        );
        process.exitCode = 2;
        return;
      }
      await delay(500);
    }
  }
  if (command !== "start") throw new Error(`Unknown command: ${command}`);
  return values.child ? start() : withStartLock(root, start);
}
async function start() {
  const existing = await readJson(join(root, "server.json")).catch(() => null);
  if (existing && alive(existing.pid)) {
    const link = new URL(existing.url);
    const params = new URLSearchParams(link.hash.slice(1));
    const healthy = await fetch(`${link.origin}/api/session`, {
      headers: {
        Authorization: `Bearer ${params.get("token")}`,
        "X-Scribble-Session": existing.sessionId,
      },
      signal: AbortSignal.timeout(1500),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (healthy) {
      let resumed = values.session
        ? await loadSession(root, values.session)
        : !values.new && (await latestSession(root, true));
      if (!resumed) resumed = await createSession(root, values.title);
      const info = {
        ...existing,
        sessionId: resumed.id,
        url: `${link.origin}/#token=${resumed.token}&session=${resumed.id}`,
        reused: true,
      };
      await atomicJson(join(root, "server.json"), info);
      if (!values["no-open"]) openBrowser(info.url);
      print(info);
      return;
    }
  }
  let session = values.session
    ? await loadSession(root, values.session)
    : !values.new && (await latestSession(root, true));
  if (!session) session = await createSession(root, values.title);
  const dir = sessionDir(root, session.id);
  // Recover a crash between writing the submission marker and updating session metadata.
  const receipt = await readJson(join(dir, "feedback.json")).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (receipt && session.status !== "submitted") {
    session.status = "submitted";
    session.submittedAt = receipt.submittedAt;
    await atomicJson(join(dir, "session.json"), session);
  }
  if (values.detach) {
    await mkdir(root, { recursive: true });
    const args = [
      cli,
      "start",
      "--dir",
      root,
      "--session",
      session.id,
      "--no-open",
      "--child",
    ];
    if (values.dev) args.push("--dev");
    if (values.port) args.push("--port", values.port);
    const log = openSync(join(root, "server.log"), "a", 0o600);
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.on("error", (e) => console.error(e.message));
    child.unref();
    closeSync(log);
    for (let i = 0; i < 100; i++) {
      const info = await readJson(join(root, "server.json")).catch(() => null);
      if (info?.pid === child.pid) {
        if (!values["no-open"]) openBrowser(info.url);
        print(info);
        return;
      }
      if (!alive(child.pid))
        throw new Error(
          "Server did not start. Read .scribble/server.log or run without --detach to see the error.",
        );
      await delay(100);
    }
    throw new Error(
      "Server startup timed out. Read .scribble/server.log or run without --detach to see the error.",
    );
  }
  const port = Number(values.port || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be an integer from 0 to 65535.");
  if (!values.dev)
    await access(join(packageRoot, "app/index.html")).catch(() => {
      throw new Error("Build the browser app first: npm run build");
    });
  const app = await startServer({ root, session, port, dev: values.dev });
  print(app.info);
  if (!values["no-open"]) openBrowser(app.url);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
