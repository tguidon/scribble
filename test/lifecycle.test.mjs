import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { stopServer } from "../skills/scribble/scripts/lib/lifecycle.mjs";
const exec = promisify(execFile);

test("installed versions restart on the same origin, preserve drafts, and stop safely", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "scribble-upgrade-"));
  const skill = join(temp, "skill");
  const root = join(temp, "data");
  await cp(resolve("skills/scribble"), skill, { recursive: true });
  const cli = join(skill, "scripts/scribble.mjs");
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args, "--dir", root], {
          cwd: temp,
        })
      ).stdout,
    );
  const pids = new Set();
  t.after(async () => {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await rm(temp, { recursive: true, force: true });
  });
  const first = await run("start", "--detach", "--no-open");
  pids.add(first.pid);
  const url = new URL(first.url);
  const headers = {
    Authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get("token")}`,
    "X-Scribble-Session": first.sessionId,
  };
  const call = (path, options = {}) =>
    fetch(url.origin + path, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  assert.equal((await call("/api/shutdown", { method: "POST" })).status, 409);
  assert.equal(
    (
      await call("/api/shutdown", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong",
          "X-Scribble-Instance": first.instanceId,
        },
      })
    ).status,
    401,
  );
  assert.equal((await call("/api/health")).status, 200);
  const saved = await call("/api/draft", {
    method: "PUT",
    body: JSON.stringify({
      revision: 0,
      message: "Keep this draft",
      images: [],
      saveId: "before-upgrade",
    }),
  });
  assert.equal(saved.status, 200);
  await writeFile(
    join(skill, "version.json"),
    JSON.stringify({ version: "9.0.0-test" }),
  );
  const upgraded = await run("start", "--detach", "--no-open");
  pids.add(upgraded.pid);
  assert.notEqual(upgraded.pid, first.pid);
  assert.notEqual(upgraded.instanceId, first.instanceId);
  assert.equal(upgraded.version, "9.0.0-test");
  assert.equal(upgraded.url, first.url);
  assert.equal(
    (await (await call("/api/session")).json()).message,
    "Keep this draft",
  );
  assert.equal((await run("start", "--detach", "--no-open")).pid, upgraded.pid);
  assert.equal((await run("status")).server.version, "9.0.0-test");
  assert.equal((await run("stop")).stopped, true);
  assert.equal((await run("stop")).alreadyStopped, true);
  assert.equal(
    JSON.parse(
      await readFile(join(root, "sessions", first.sessionId, "session.json")),
    ).message,
    "Keep this draft",
  );
  const resumed = await run("start", "--detach", "--no-open");
  pids.add(resumed.pid);
  assert.equal(resumed.sessionId, first.sessionId);
  await run("stop");
});

test("stop refuses unverified process identities and legacy shutdown", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "scribble-legacy-"));
  let identity = { pid: process.pid + 1 };
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/health");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(identity));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const info = {
    pid: process.pid,
    url: `http://127.0.0.1:${server.address().port}/#token=test`,
    sessionId: "test",
  };
  await assert.rejects(stopServer(root, info), /health check/);
  identity = { pid: process.pid };
  await assert.rejects(
    stopServer(root, info),
    /older server does not support safe shutdown/,
  );
  assert.equal(server.listening, true);
});

test("release metadata and the standalone CLI report the same version", async () => {
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve("package-lock.json"), "utf8"));
  const bundled = JSON.parse(
    await readFile(resolve("skills/scribble/version.json"), "utf8"),
  );
  const { stdout } = await exec(process.execPath, [
    resolve("bin/scribble.mjs"),
    "--version",
  ]);
  assert.equal(bundled.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(stdout.trim(), pkg.version);
});
