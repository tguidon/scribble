import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PluginBackend } from "../plugin/backend.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";

const exec = promisify(execFile);
const git = async (project, ...args) =>
  (await exec("git", ["-C", project, ...args])).stdout;

test("plugin excludes private storage when Git is initialized after the server starts", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "scribble-plugin-git-init-"));
  const root = join(project, ".scribble");
  const http = await startServer({ root, session: await createSession(root) });
  t.after(async () => {
    await http.close();
    await rm(project, { recursive: true, force: true });
  });
  await git(project, "init", "--quiet");
  const backend = new PluginBackend({ directory: join(project, "registry") });
  await backend.open(project, "After git init");
  assert.equal(
    await git(
      project,
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ".scribble",
    ),
    "",
  );
});

for (const running of [false, true]) {
  test(`plugin rejects tracked storage before writing a session with server running=${running}`, async (t) => {
    const project = await mkdtemp(join(tmpdir(), "scribble-plugin-tracked-"));
    const root = join(project, ".scribble");
    let http;
    t.after(async () => {
      await http?.close();
      await rm(project, { recursive: true, force: true });
    });
    await mkdir(root);
    await writeFile(join(root, "tracked-marker"), "tracked storage\n");
    if (running)
      http = await startServer({ root, session: await createSession(root) });
    await git(project, "init", "--quiet");
    await git(project, "add", ".scribble/tracked-marker");
    const before = await readdir(join(root, "sessions")).catch(() => []);
    const backend = new PluginBackend({ directory: join(project, "registry") });
    await assert.rejects(
      backend.open(project, "Must not write"),
      /already tracked/,
    );
    assert.deepEqual(
      await readdir(join(root, "sessions")).catch(() => []),
      before,
    );
  });
}

test("New canvas excludes private storage after Git is initialized", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "scribble-plugin-next-git-"));
  const root = join(project, ".scribble");
  const http = await startServer({ root, session: await createSession(root) });
  t.after(async () => {
    await http.close();
    await rm(project, { recursive: true, force: true });
  });
  const backend = new PluginBackend({ directory: join(project, "registry") });
  const connection = await backend.open(project, "Before git init");
  const image = await backend.request(
    connection.sessionId,
    connection.token,
    "/images?revision=0&imageId=uploaded-image&width=1&height=1&name=proof.png",
    "POST",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    true,
  );
  assert.equal(image.status, 201);
  const draft = JSON.parse(Buffer.from(image.body, "base64").toString());
  const submitted = await backend.request(
    connection.sessionId,
    connection.token,
    "/submit",
    "POST",
    JSON.stringify({ revision: draft.revision }),
  );
  assert.equal(submitted.status, 200);
  await git(project, "init", "--quiet");
  const next = await backend.request(
    connection.sessionId,
    connection.token,
    "/sessions",
    "POST",
    "{}",
  );
  assert.equal(next.status, 200);
  assert.equal(
    await git(
      project,
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ".scribble",
    ),
    "",
  );
});
