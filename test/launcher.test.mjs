import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("copied skill starts without dependencies; concurrent launchers reuse and restart the server", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "scribble-installed-"));
  const skill = join(temp, "skill");
  const root = join(temp, "data");
  await cp(resolve("skills/scribble"), skill, { recursive: true });
  const cli = join(skill, "scripts/scribble.mjs");
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
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args, "--dir", root], {
          cwd: temp,
        })
      ).stdout,
    );
  const launches = await Promise.all([
    run("start", "--detach", "--no-open"),
    run("start", "--detach", "--no-open"),
  ]);
  for (const result of launches) pids.add(result.pid);
  assert.equal(launches[0].pid, launches[1].pid);
  assert.equal(launches[0].sessionId, launches[1].sessionId);
  assert.equal((await fetch(launches[0].url.split("#")[0])).status, 200);
  const fresh = await run("start", "--detach", "--no-open", "--new");
  assert.equal(fresh.pid, launches[0].pid);
  assert.notEqual(fresh.sessionId, launches[0].sessionId);
  process.kill(fresh.pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  const resumed = await run("start", "--detach", "--no-open");
  pids.add(resumed.pid);
  assert.notEqual(resumed.pid, fresh.pid);
  assert.equal(resumed.sessionId, fresh.sessionId);
  const status = await run("status");
  assert.equal(status.session.id, resumed.sessionId);
});

test("wait returns the durable bundle and the next invocation creates fresh feedback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "scribble-handoff-"));
  const cli = resolve("bin/scribble.mjs");
  let pid;
  t.after(async () => {
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
    await rm(root, { recursive: true, force: true });
  });
  const run = async (...args) =>
    JSON.parse(
      (await exec(process.execPath, [cli, ...args, "--dir", root])).stdout,
    );
  const first = await run("start", "--detach", "--no-open");
  pid = first.pid;
  const url = new URL(first.url);
  const params = new URLSearchParams(url.hash.slice(1));
  const headers = {
    Authorization: `Bearer ${params.get("token")}`,
    "X-Scribble-Session": first.sessionId,
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const draft = await (
    await fetch(`${url.origin}/api/images?width=1&height=1&name=one.png`, {
      method: "POST",
      headers,
      body: png,
    })
  ).json();
  const waiting = run("wait", "--session", first.sessionId, "--timeout", "5");
  await fetch(`${url.origin}/api/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: draft.revision }),
  });
  const bundle = await waiting;
  assert.equal(bundle.feedback.sessionId, first.sessionId);
  assert.equal(bundle.feedback.images.length, 1);
  const next = await run("start", "--detach", "--no-open");
  assert.equal(next.pid, first.pid);
  assert.notEqual(next.sessionId, first.sessionId);
  assert.equal(
    (await run("feedback", "--session", first.sessionId)).feedback.images
      .length,
    1,
  );
});
