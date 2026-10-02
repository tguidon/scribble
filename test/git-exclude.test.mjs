import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { excludeStorage } from "../skills/scribble/scripts/lib/git-exclude.mjs";
const exec = promisify(execFile);

test("storage exclusions are local, literal, idempotent, and work in linked worktrees", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "scribble-git-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = join(temp, "repo");
  await mkdir(repo);
  const git = (...args) => exec("git", ["-C", repo, ...args]);
  await git("init");
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  );
  const exclude = join(repo, ".git/info/exclude");
  await writeFile(exclude, "# Keep this without a trailing newline");
  for (const path of [".scribble", "nested/feedback [test]* "]) {
    const storage = join(repo, path);
    await excludeStorage(storage);
    await excludeStorage(storage);
    await writeFile(join(storage, "secret.json"), "private");
    await git("check-ignore", "--quiet", `${path}/secret.json`);
  }
  assert.equal(
    (await readFile(exclude, "utf8")).match(/^\/\.scribble\/$/gm).length,
    1,
  );
  assert.equal((await git("status", "--porcelain")).stdout, "");
  const worktree = join(temp, "worktree");
  await git("worktree", "add", "-b", "test-worktree", worktree);
  await excludeStorage(join(worktree, ".scribble"));
  await exec("git", [
    "-C",
    worktree,
    "check-ignore",
    "--quiet",
    ".scribble/secret.json",
  ]);
  const external = join(temp, "not-a-repo");
  await excludeStorage(external);
  assert.equal(
    await readFile(join(external, ".gitignore"), "utf8").catch(() => null),
    null,
  );
  const tracked = join(repo, "tracked");
  await mkdir(tracked);
  await writeFile(join(tracked, "data.json"), "existing");
  await git("add", "tracked");
  await assert.rejects(excludeStorage(tracked), /already tracked/);
  assert.equal(await readFile(join(tracked, "data.json"), "utf8"), "existing");
  await assert.rejects(excludeStorage(repo), /not the project root/);
});
