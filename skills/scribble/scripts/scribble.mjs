#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, access } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { withStartLock, alive } from "./lib/lock.mjs";
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
import { pendingFeedback, acknowledgeFeedback } from "./lib/handoff.mjs";
import { excludeStorage } from "./lib/git-exclude.mjs";
import { VERSION, SERVER_PROTOCOL } from "./lib/version.mjs";
import { serverHealth, stopServer } from "./lib/lifecycle.mjs";
import { writeFeedbackBrief } from "./lib/brief.mjs";
import { setupCapture } from "./lib/capture/runtime.mjs";
const cli = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(cli), "..");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
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
    version: { type: "boolean" },
    full: { type: "boolean" },
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
  if (values.version || command === "version") {
    console.log(VERSION);
    return;
  }
  if (values.help || command === "help") {
    console.log(`Scribble ${VERSION} — show your agent what you mean.

  scribble start [--detach] [--no-open] [--new] [--session ID]
  scribble wait --session ID [--timeout SECONDS] [--full]
  scribble feedback --session ID [--full]
  scribble ack --session ID
  scribble stop
  scribble status
  scribble --version
  scribble setup web|simulator

Install: npx skills add tguidon/scribble
Installed skills include the app and server. Node.js 22+ is required; no build is needed.
Run with: node /absolute/path/to/skills/scribble/scripts/scribble.mjs COMMAND
In this repository: node bin/scribble.mjs COMMAND

Options: --dir PATH (default .scribble in this project), --port NUMBER,
         --title TEXT, --timeout SECONDS (wait only; default 3600).
Use the same --dir for every command when choosing custom storage.

start recovers unread feedback before opening a draft. Read each bundle and its
images, then use ack to mark it as read. --new bypasses recovery without clearing it.
wait exits with code 2 on timeout. feedback rereads a submission without acknowledging it.
wait and feedback return a Markdown brief with image paths and computed geometry.
The brief is saved as feedback.md. --full returns the original JSON, including all drawing points.
start reuses a matching server or restarts an older version on the same port.
stop shuts down the authenticated server. Drafts and submissions remain on disk.
Before an upgrade or stop, wait for Draft saved in open browser tabs. Reload after upgrading.
Update an installation with: npx skills add tguidon/scribble
Developers changing the UI in this repository must run npm run build before committing.`);
    return;
  }
  if (command === "setup") {
    await excludeStorage(root);
    await withStartLock(root, () => setupCapture(root, positionals[1]));
    print({ ready: true, capture: positionals[1], root });
    return;
  }
  if (command === "stop") {
    print(
      await withStartLock(root, async () =>
        stopServer(
          root,
          await readJson(join(root, "server.json")).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          }),
        ),
      ),
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
      pendingFeedback: await pendingFeedback(root),
    });
    return;
  }
  if (command === "ack") {
    if (!values.session)
      throw new Error(
        "Use ack --session ID after reading the feedback and images.",
      );
    print(await acknowledgeFeedback(root, values.session));
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
      const feedback = await readJson(path).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (feedback) {
        const summary = await writeFeedbackBrief(feedback, dirname(path));
        print(
          values.full
            ? { bundlePath: path, feedback }
            : { sessionId: feedback.sessionId, bundlePath: path, ...summary },
        );
        return;
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
  const port = Number(values.port || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be an integer from 0 to 65535.");
  return values.child ? start() : withStartLock(root, start);
}
async function start() {
  if (!values.child) await excludeStorage(root);
  if (!values.child && !values.new && !values.session) {
    const pending = await pendingFeedback(root);
    if (pending.length) {
      print({ action: "read-feedback", pendingFeedback: pending });
      return;
    }
  }
  const existing = await readJson(join(root, "server.json")).catch(() => null);
  if (existing && alive(existing.pid)) {
    const health = await serverHealth(existing);
    const link = new URL(existing.url);
    if (health.version === VERSION && health.protocol === SERVER_PROTOCOL) {
      let resumed = values.session
        ? await loadSession(root, values.session)
        : !values.new && (await latestSession(root));
      if (!values.session && resumed?.status === "submitted") resumed = null;
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
    await stopServer(root, existing);
    // Keep the browser origin stable so local unsaved backups remain available.
    if (values.port === undefined) values.port = String(existing.port);
  }
  let session = values.session
    ? await loadSession(root, values.session)
    : !values.new && (await latestSession(root));
  if (!values.session && session?.status === "submitted") session = null;
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
      throw new Error(
        "The bundled browser app is missing. Reinstall with npx skills add tguidon/scribble. For a source checkout, run npm run build.",
      );
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
