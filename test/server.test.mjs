import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  loadSession,
} from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "scribble-test-"));
  const session = await createSession(root);
  const app = await startServer({ root, session });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = app.url.split("/#")[0];
  const call = (path, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: { Authorization: `Bearer ${session.token}`, ...options.headers },
    });
  return { root, session, app, base, call };
}
test("uploads, saves, submits once, and preserves a readable feedback bundle", async (t) => {
  const { call, root, session } = await setup(t);
  const upload = await call("/api/images?width=1&height=1&name=test.png", {
    method: "POST",
    body: png,
  });
  assert.equal(upload.status, 201);
  const draft = await upload.json();
  draft.message = "Make this clearer.";
  draft.images[0].annotations = [
    {
      id: "mark-1",
      type: "pin",
      color: "#ed6445",
      points: [{ x: 0.5, y: 0.5 }],
      comment: "Change this.",
    },
  ];
  const saved = await (
    await call("/api/draft", { method: "PUT", body: JSON.stringify(draft) })
  ).json();
  assert.equal(saved.revision, 2);
  assert.equal(
    (await call("/api/draft", { method: "PUT", body: JSON.stringify(draft) }))
      .status,
    400,
  );
  const sent = await call("/api/submit", {
    method: "POST",
    body: JSON.stringify({ revision: saved.revision }),
  });
  assert.equal(sent.status, 200);
  assert.equal(
    (await call("/api/submit", { method: "POST", body: "{}" })).status,
    409,
  );
  const bundle = await (await call("/api/feedback")).json();
  assert.equal(bundle.images[0].annotations[0].number, 1);
  assert.equal(bundle.message, "Make this clearer.");
  assert.deepEqual(await readFile(bundle.images[0].path), png);
  assert.equal((await loadSession(root, session.id)).status, "submitted");
});
test("rejects unauthenticated, cross-origin, oversized coordinates and active image uploads", async (t) => {
  const { call, base } = await setup(t);
  assert.equal((await fetch(base + "/api/session")).status, 401);
  assert.equal(
    (await call("/api/session", { headers: { Origin: "https://example.com" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("/api/images?width=1&height=1", {
        method: "POST",
        body: '<svg onload="alert(1)"/>',
      })
    ).status,
    400,
  );
  const draft = await (
    await call("/api/images?width=1&height=1", { method: "POST", body: png })
  ).json();
  draft.images[0].annotations = [
    {
      id: "bad",
      type: "pin",
      color: "#000000",
      points: [{ x: 999, y: 0 }],
      comment: "",
    },
  ];
  assert.equal(
    (await call("/api/draft", { method: "PUT", body: JSON.stringify(draft) }))
      .status,
    400,
  );
  assert.equal(
    (await call("/api/submit", { method: "POST", body: '{"revision":0}' }))
      .status,
    409,
  );
});
test("one server handles isolated sessions and recovers a committed receipt", async (t) => {
  const { call, root, session, base } = await setup(t);
  const other = await createSession(root);
  const response = await fetch(base + "/api/session", {
    headers: {
      Authorization: `Bearer ${other.token}`,
      "X-Scribble-Session": other.id,
    },
  });
  assert.equal((await response.json()).id, other.id);
  assert.equal(
    (
      await fetch(base + "/api/session", {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-Scribble-Session": other.id,
        },
      })
    ).status,
    401,
  );
  assert.equal((await call("/api/session")).status, 200);
});

test("clipboard handoffs survive new canvases, reloads, and legacy receipts", async (t) => {
  const { call, base, root, session } = await setup(t);
  assert.equal((await fetch(base + "/api/handoff")).status, 401);
  assert.equal((await call("/api/handoff")).status, 404);
  assert.equal(
    (await call("/api/sessions", { method: "POST", body: "{}" })).status,
    409,
  );
  const draft = await (
    await call("/api/images?width=1&height=1&name=test.png", {
      method: "POST",
      body: png,
    })
  ).json();
  assert.equal(
    (
      await call("/api/submit", {
        method: "POST",
        body: JSON.stringify({ revision: draft.revision }),
      })
    ).status,
    200,
  );
  // The brief exists even if no agent is listening and no handoff GET has run.
  const directory = join(root, "sessions", session.id);
  const brief = await readFile(join(directory, "feedback.md"), "utf8");
  const bundle = await readFile(join(directory, "feedback.json"), "utf8");
  const handoff = await (await call("/api/handoff")).json();
  assert.equal(handoff.sessionId, session.id);
  assert.ok(handoff.text.includes(JSON.stringify(handoff.briefPath)));
  assert.ok(handoff.text.includes(JSON.stringify(handoff.bundlePath)));
  assert.ok(handoff.text.length < 1500);
  assert.ok(!handoff.text.includes(session.token));
  const image = JSON.parse(bundle).images[0];
  assert.ok(brief.includes(image.path));
  assert.deepEqual(await readFile(image.path), png);
  const create = () =>
    call("/api/sessions", { method: "POST", body: "{}" }).then((r) => r.json());
  const [next, retry] = await Promise.all([create(), create()]);
  assert.deepEqual(next, retry);
  const params = new URLSearchParams(new URL(next.url, base).hash.slice(1));
  const nextId = params.get("session");
  assert.notEqual(nextId, session.id);
  assert.equal((await loadSession(root, nextId)).images.length, 0);
  assert.equal((await loadSession(root, session.id)).status, "submitted");
  assert.equal(await readFile(handoff.bundlePath, "utf8"), bundle);
  // An old receipt missing its generated brief can still be copied.
  await rm(handoff.briefPath);
  assert.deepEqual(await (await call("/api/handoff")).json(), handoff);
  assert.equal(await readFile(handoff.briefPath, "utf8"), brief);
  assert.equal(
    (
      await fetch(base + "/api/handoff", {
        headers: {
          Authorization: `Bearer ${params.get("token")}`,
          "X-Scribble-Session": session.id,
        },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/api/sessions", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
        body: "{}",
      })
    ).status,
    403,
  );
});
