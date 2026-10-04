import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WebCapture } from "../skills/scribble/scripts/lib/capture/web.mjs";
import {
  SimulatorCapture,
  readFrame,
} from "../skills/scribble/scripts/lib/capture/simulator.mjs";
import {
  localUrl,
  webpageUrl,
  imageDimensions,
} from "../skills/scribble/scripts/lib/capture/common.mjs";
import { createSession } from "../skills/scribble/scripts/lib/store.mjs";
import { startServer } from "../skills/scribble/scripts/lib/app.mjs";
import { renderFeedbackBrief } from "../skills/scribble/scripts/lib/brief.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        instance.close(resolve);
        instance.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${instance.address().port}`;
}
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), "scribble-capture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("capture URLs are local and captured dimensions come from image bytes", () => {
  for (const url of [
    "http://localhost:3000/path",
    "http://127.0.0.1:9",
    "https://[::1]:3000",
  ])
    assert.ok(localUrl(url));
  for (const url of [
    "https://example.com",
    "file:///etc/passwd",
    "http://localhost.evil.test",
    "http://user:pass@localhost",
    "not a url",
  ])
    assert.throws(() => localUrl(url));
  assert.equal(webpageUrl("example.com/path").href, "https://example.com/path");
  assert.equal(webpageUrl("localhost:3000").href, "http://localhost:3000/");
  assert.equal(webpageUrl("https://example.com").hostname, "example.com");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com",
    "https://user:pass@example.com",
    " ",
  ])
    assert.throws(() => webpageUrl(url));
  assert.deepEqual(imageDimensions(png), { width: 1, height: 1 });
  assert.throws(() => imageDimensions(Buffer.alloc(30)));
});

test("controlled webpage captures preserve navigation, scroll, viewport, and frozen bytes", async (t) => {
  const root = await temp(t);
  const destination = await server(t, (_req, res) =>
    res.end("<title>Redirect destination</title><h1>Another origin</h1>"),
  );
  const url = await server(t, (req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: destination });
      res.end();
      return;
    }
    res.end(
      '<title>Local review</title><body style="height:2200px;background:#f5f0e8"><button onclick="this.textContent=\'Changed\'">Continue</button><a href="/next">Next screen</a></body>',
    );
  });
  const web = new WebCapture(root, { headless: true, channel: "chrome" });
  t.after(() => web.close());
  await web.open({ url, width: 800, height: 600 });
  await web.page.getByRole("button").click();
  await web.page.evaluate(() => scrollTo(0, 400));
  const first = await web.capture();
  assert.equal(first.source.url, url + "/");
  assert.equal(first.source.scroll.y, 400);
  assert.deepEqual(first.source.viewport, { width: 800, height: 600 });
  assert.deepEqual(
    { width: first.width, height: first.height },
    { width: 800, height: 600 },
  );
  await web.page.evaluate(() => {
    document.body.style.background = "#112233";
  });
  const second = await web.capture();
  assert.notDeepEqual(first.bytes, second.bytes);
  await web.page.getByRole("link").click();
  assert.equal((await web.capture()).source.url, url + "/next");
  // Unrelated tabs must not silently replace the explicitly opened capture page.
  const originalPage = web.page;
  const secondTab = await web.context.newPage();
  await web.guard(secondTab);
  await secondTab.goto(url + "/second-tab");
  await secondTab.bringToFront();
  assert.equal((await web.capture()).source.url, url + "/next");
  await web.focus();
  assert.equal(web.page, originalPage);
  await originalPage.close();
  await assert.rejects(web.capture(), /Open a webpage/);
  await web.open({ url, width: 800, height: 600 });
  assert.equal((await web.capture()).source.url, url + "/");
  await web.context.route("https://capture.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Public capture</title><h1>Public URL</h1>",
    }),
  );
  await web.open({ url: "https://capture.example/", width: 800, height: 600 });
  assert.equal((await web.capture()).source.url, "https://capture.example/");
  await web.open({ url: url + "/redirect", width: 800, height: 600 });
  assert.equal((await web.capture()).source.url, destination + "/");
  await web.close();
  await assert.rejects(web.capture(), /Open a webpage/);
});

test("simulator consumes exactly one bounded frame and detects rotation and disconnection", async (t) => {
  const root = await temp(t);
  let orientation = "portrait",
    frameCount = 0,
    rotateDuringFrame = false;
  const url = await server(t, (req, res) => {
    if (req.url.endsWith("/config")) {
      res.end(JSON.stringify({ width: 1, height: 1, orientation }));
      return;
    }
    if (req.url.endsWith("/foreground")) {
      res.end(JSON.stringify({ bundleId: "dev.example.app" }));
      return;
    }
    if (req.url.endsWith("/stream.mjpeg")) {
      frameCount++;
      if (rotateDuringFrame) orientation = "portrait";
      res.setHeader(
        "Content-Type",
        "multipart/x-mixed-replace; boundary=frame",
      );
      res.write(
        "--frame\r\nContent-Type: image/png\r\nContent-Length: " +
          png.length +
          "\r\n\r\n",
      );
      res.write(png.subarray(0, 20));
      res.write(png.subarray(20));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const device = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test iPhone",
  };
  const command = join(root, "serve-sim.mjs");
  await writeFile(
    command,
    `console.log(JSON.stringify(${JSON.stringify({ device: device.id, url, streamUrl: url + "/helper/" + device.id + "/stream.mjpeg" })}))`,
  );
  const sim = new SimulatorCapture(root, {
    devices: async () => [device],
    command: { file: process.execPath, args: [command] },
  });
  await sim.open({ deviceId: device.id });
  const first = await sim.capture();
  assert.equal(frameCount, 1);
  assert.equal(first.width, 1);
  assert.equal(first.source.appBundleId, "dev.example.app");
  assert.equal(first.source.device.id, device.id);
  orientation = "landscape_left";
  assert.equal((await sim.capture()).source.orientation, orientation);
  assert.equal(
    new URL(sim.state().previewUrl).searchParams.get("device"),
    device.id,
  );
  rotateDuringFrame = true;
  await assert.rejects(sim.capture(), /rotated during capture/);
  await sim.close();
  await assert.rejects(sim.capture(), /Connect a simulator/);
  await assert.rejects(sim.open({ deviceId: "bad" }), /Choose a booted/);
  await assert.rejects(readFrame(url + "/missing"), /unavailable/);
  const malformed = await server(t, (_req, res) =>
    res.end("--frame\r\nContent-Length: 999999999\r\n\r\n"),
  );
  await assert.rejects(readFrame(malformed), /oversized/);
});

test("capture API saves immutable images, retries without duplicates, and submits source context", async (t) => {
  const root = await temp(t);
  const pageUrl = await server(t, (_req, res) =>
    res.end("<title>Capture me</title><h1>Before</h1>"),
  );
  const session = await createSession(root);
  const app = await startServer({
    root,
    session,
    captureOptions: { web: { headless: true, channel: "chrome" } },
  });
  t.after(() => app.close());
  const origin = new URL(app.url).origin;
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
  const call = (path, data) =>
    fetch(origin + "/api" + path, {
      headers,
      ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
    });
  assert.equal((await fetch(origin + "/api/capture/status")).status, 401);
  assert.equal(
    (
      await call("/capture/open", {
        kind: "web",
        url: pageUrl,
        width: 800,
        height: 600,
      })
    ).status,
    200,
  );
  const mismatch = await fetch(origin + "/api/draft", {
    method: "PUT",
    headers: { ...headers, "X-Scribble-Version": "0.0.0" },
    body: JSON.stringify({}),
  });
  assert.equal(mismatch.status, 409);
  assert.match((await mismatch.json()).error, /versions differ/);
  const snapshot = { kind: "web", captureId: "first-capture", revision: 0 };
  const captured = await (await call("/capture/snapshot", snapshot)).json();
  assert.equal(captured.images.length, 1);
  assert.equal(captured.images[0].source.url, pageUrl + "/");
  assert.equal(captured.images[0].width, 800);
  const original = await readFile(
    join(root, "sessions", session.id, "images", captured.images[0].file),
  );
  const repeated = await (await call("/capture/snapshot", snapshot)).json();
  assert.equal(repeated.revision, captured.revision);
  assert.equal(repeated.images.length, 1);
  assert.equal(
    (await call("/capture/snapshot", { ...snapshot, captureId: "stale" }))
      .status,
    409,
  );
  const annotated = {
    revision: captured.revision,
    message: "Improve this screen",
    images: [
      {
        ...captured.images[0],
        source: { kind: "forged" },
        annotations: [
          {
            id: "pin1",
            type: "pin",
            color: "#c94b35",
            comment: "Move this",
            points: [{ x: 50, y: 50 }],
          },
        ],
      },
    ],
  };
  const saved = await (
    await fetch(origin + "/api/draft", {
      method: "PUT",
      headers,
      body: JSON.stringify(annotated),
    })
  ).json();
  assert.equal(saved.images[0].source.kind, "web");
  assert.equal(
    (await call("/submit", { revision: saved.revision })).status,
    200,
  );
  const bundle = await (await call("/feedback")).json();
  assert.equal(bundle.images[0].annotations[0].comment, "Move this");
  assert.equal(bundle.images[0].source.viewport.width, 800);
  assert.match(renderFeedbackBrief(bundle), /Capture context/);
  assert.deepEqual(await readFile(bundle.images[0].path), original);
  assert.equal(
    (
      await call("/capture/snapshot", {
        ...snapshot,
        captureId: "after-submit",
      })
    ).status,
    409,
  );
});

test("live webpage input maps normalized coordinates and releases interrupted drags", async (t) => {
  const root = await temp(t);
  const url = await server(t, (_req, res) =>
    res.end(
      `<!doctype html><input style="position:absolute;left:0;top:0;width:250px;height:80px"><button style="position:absolute;left:0;top:120px;width:250px;height:80px" onmousedown="document.body.dataset.down='yes'" onmouseup="document.body.dataset.down='no'">Touch</button><div style="height:3000px"></div>`,
    ),
  );
  const web = new WebCapture(root, { headless: true, channel: "chrome" });
  t.after(() => web.close());
  await web.open({ url, width: 800, height: 600 });
  const pointer = async (phase, y) =>
    web.input({ type: "pointer", phase, x: 0.1, y });
  await pointer("down", 0.05);
  await pointer("up", 0.05);
  await web.input({ type: "text", text: "Embedded input" });
  await web.input({ type: "key", key: "!", shift: true });
  assert.equal(await web.page.locator("input").inputValue(), "Embedded input!");
  await pointer("down", 0.25);
  assert.equal(await web.page.locator("body").getAttribute("data-down"), "yes");
  await web.input({ type: "release" });
  assert.equal(await web.page.locator("body").getAttribute("data-down"), "no");
  await web.input({ type: "wheel", dx: 0, dy: 400 });
  await web.page.waitForFunction(() => scrollY > 0);
  assert.ok((await web.capture()).source.scroll.y > 0);
  await assert.rejects(
    web.input({ type: "pointer", phase: "down", x: 2, y: 0 }),
    /coordinates/,
  );
  await assert.rejects(
    web.input({ type: "key", key: "Control+Delete" }),
    /not supported/,
  );
});

test("live streams require auth, stay isolated from saved drafts, and stop on disconnect", async (t) => {
  const root = await temp(t);
  const source = await server(t, (_req, res) =>
    res.end("<title>Live stream</title><h1>Connected</h1>"),
  );
  const session = await createSession(root);
  const app = await startServer({
    root,
    session,
    captureOptions: { web: { headless: true, channel: "chrome" } },
  });
  t.after(() => app.close());
  const origin = new URL(app.url).origin;
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
  const post = (path, data) =>
    fetch(origin + "/api/capture/" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
  assert.equal(
    (await fetch(origin + "/api/capture/stream?kind=web")).status,
    401,
  );
  await post("open", { kind: "web", url: source, width: 800, height: 600 });
  const abort = new AbortController();
  const stream = await fetch(origin + "/api/capture/stream?kind=web", {
    headers,
    signal: abort.signal,
  });
  assert.equal(stream.headers.get("content-type"), "application/octet-stream");
  const reader = stream.body.getReader();
  const chunk = await reader.read();
  assert.match(
    Buffer.from(chunk.value).toString("ascii", 0, 100),
    /Content-Length/,
  );
  const saved = await (
    await fetch(origin + "/api/session", { headers })
  ).json();
  assert.equal(saved.images.length, 0);
  assert.equal(saved.revision, 0);
  assert.equal(
    (
      await post("input", {
        kind: "web",
        type: "pointer",
        phase: "down",
        x: -1,
        y: 0,
      })
    ).status,
    400,
  );
  await post("disconnect", { kind: "web" });
  // A disconnect terminates the stream instead of retaining a browser or HTTP client.
  let done = false;
  while (!done) ({ done } = await reader.read());
  abort.abort();
  assert.equal(
    (await post("input", { kind: "web", type: "text", text: "late" })).status,
    409,
  );
});

test("simulator input uses one socket and releases touches and keyboard modifiers", async () => {
  const { SimulatorInput, simKey } =
    await import("../skills/scribble/scripts/lib/capture/sim-input.mjs");
  const sim = new SimulatorInput("ws://127.0.0.1:3100/ws");
  const sent = [];
  sim.socket = {
    readyState: WebSocket.OPEN,
    send: (bytes) =>
      sent.push({ type: bytes[0], ...JSON.parse(bytes.subarray(1)) }),
    close() {},
  };
  await sim.input({ type: "pointer", phase: "down", x: 0.3, y: 0.5 });
  await sim.input({ type: "pointer", phase: "move", x: 0.3, y: 0.7 });
  sim.release();
  assert.deepEqual(
    sent.map((x) => x.type),
    ["begin", "move", "end"],
  );
  sent.length = 0;
  await sim.input({ type: "text", text: "A!" });
  assert.equal(
    sent.filter((x) => x.type === "down" && x.usage === 225).length,
    2,
  );
  assert.equal(
    sent.filter((x) => x.type === "up" && x.usage === 225).length,
    2,
  );
  assert.throws(() => simKey("😀"), /US keyboard/);
  sim.close();
});
