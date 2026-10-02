import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createSession,
  loadSession,
} from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import {
  MAX_DRAFT_BYTES,
  DRAFT_TOO_LARGE,
  draftBytes,
} from "../skills/scribble/scripts/lib/limits.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "scribble-regression-"));
  const session = await createSession(root);
  const app = await startServer({ root, session });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const origin = new URL(app.url).origin;
  const headers = {
    Authorization: `Bearer ${session.token}`,
    Connection: "close",
  };
  const call = (path, options = {}) =>
    fetch(origin + path, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(5000),
    });
  return { root, session, app, origin, headers, call };
}
test("a save can be retried after a lost response and after a server restart", async (t) => {
  const { root, session, app, call } = await setup(t);
  const draft = {
    revision: 0,
    saveId: "save-one",
    message: "Original edit",
    images: [],
  };
  const send = (body) =>
    call("/api/draft", { method: "PUT", body: JSON.stringify(body) });
  const first = await (await send(draft)).json();
  assert.equal(first.revision, 1);
  assert.equal(first.lastSaveId, "save-one");
  assert.equal((await (await send(draft)).json()).revision, 1);
  assert.equal(
    (await send({ ...draft, message: "Different content with same ID" }))
      .status,
    409,
  );
  await app.close();
  const restarted = await startServer({ root, session });
  t.after(() => restarted.close());
  const replay = await fetch(new URL(restarted.url).origin + "/api/draft", {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(draft),
  });
  assert.equal((await replay.json()).revision, 1);
  const next = await fetch(new URL(restarted.url).origin + "/api/draft", {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      ...draft,
      revision: 1,
      saveId: "save-two",
      message: "Newer edit",
    }),
  });
  assert.equal((await next.json()).message, "Newer edit");
  assert.equal((await loadSession(root, session.id)).revision, 2);
});
test("slow uploads do not block health, reads, other sessions, or launcher reuse", async (t) => {
  const { root, session, app, origin, headers, call } = await setup(t);
  const slow = httpRequest(origin + "/api/images?width=1&height=1", {
    method: "POST",
    headers: { ...headers, "Content-Length": png.length + 1 },
  });
  slow.on("error", () => {});
  const completed = new Promise((resolve) =>
    slow.on("response", (r) => {
      r.resume();
      r.on("end", () => resolve(r.statusCode));
    }),
  );
  t.after(() => slow.destroy());
  slow.write(png);
  assert.equal((await call("/api/health")).status, 200);
  assert.equal((await call("/api/session")).status, 200);
  const other = await createSession(root);
  assert.equal(
    (
      await call("/api/draft", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${other.token}`,
          "X-Scribble-Session": other.id,
        },
        body: JSON.stringify({
          revision: 0,
          saveId: "other-save",
          images: [],
          message: "Independent",
        }),
      })
    ).status,
    200,
  );
  const result = JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        [
          resolve("bin/scribble.mjs"),
          "start",
          "--detach",
          "--no-open",
          "--dir",
          root,
        ],
        { timeout: 8000 },
      )
    ).stdout,
  );
  assert.equal(result.pid, app.info.pid);
  assert.equal(result.reused, true);
  slow.end(Buffer.from([0]));
  assert.equal(await completed, 201);
  assert.equal((await loadSession(root, session.id)).images.length, 1);
});
test("only one server can own a storage directory and failure releases ownership", async (t) => {
  const { root, session, app } = await setup(t);
  await assert.rejects(startServer({ root, session }), /already owns/);
  await app.close();
  await assert.rejects(startServer({ root, session, port: -1 }));
  const replacement = await startServer({ root, session });
  await replacement.close();
});
test("draft byte budget agrees with validation and reports a draft-specific error", async (t) => {
  const { call } = await setup(t);
  const draft = await (
    await call("/api/images?width=1&height=1", { method: "POST", body: png })
  ).json();
  const annotations = Array.from({ length: 450 }, (_, i) => ({
    id: `pin-${i}`,
    type: "pin",
    color: "#c94b35",
    comment: "x".repeat(10000),
    points: [{ x: 0.5, y: 0.5 }],
  }));
  const body = {
    message: "",
    images: [{ ...draft.images[0], annotations }],
    revision: draft.revision,
    saveId: "budget",
  };
  const excess = draftBytes(body) - MAX_DRAFT_BYTES;
  assert.ok(excess > 0);
  let remaining = excess;
  for (const mark of annotations) {
    const remove = Math.min(remaining, mark.comment.length);
    mark.comment = mark.comment.slice(remove);
    remaining -= remove;
  }
  assert.equal(draftBytes(body), MAX_DRAFT_BYTES);
  const saved = await call("/api/draft", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  assert.equal(saved.status, 200);
  const revision = (await saved.json()).revision;
  annotations[0].comment += "é";
  assert.equal(draftBytes(body), MAX_DRAFT_BYTES + 2);
  const rejected = await call("/api/draft", {
    method: "PUT",
    body: JSON.stringify({ ...body, revision, saveId: "too-big" }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, DRAFT_TOO_LARGE);
  const enormous = await call("/api/draft", {
    method: "PUT",
    body: JSON.stringify({ ...body, message: "x".repeat(3000) }),
  });
  assert.equal(enormous.status, 413);
  assert.equal((await enormous.json()).error, DRAFT_TOO_LARGE);
  assert.equal(
    (
      await call("/api/submit", {
        method: "POST",
        body: JSON.stringify({ revision }),
      })
    ).status,
    200,
  );
});
