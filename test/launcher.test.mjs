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
