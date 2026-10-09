import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  renderFeedbackBrief,
  simplifyFreehand,
  summarizeImage,
} from "../skills/scribble/scripts/lib/brief.mjs";
import {
  atomicJson,
  createSession,
  sessionDir,
} from "../skills/scribble/scripts/lib/store.mjs";

const exec = promisify(execFile);
const mark = (type, points, comment = "") => ({
  id: `mark-${type}`,
  type,
  points,
  comment,
  color: "#3559c7",
});
const image = (annotations) => ({
  name: "screen.png",
  path: "/project/images/screen.png",
  width: 1200,
  height: 800,
  annotations,
});
const bundle = (images) => ({
  version: 1,
  sessionId: "session-1",
  title: "Feedback",
  submittedAt: "2026-10-02T00:00:00Z",
  message: "Keep the goal clear.\n\nDo this first.",
  images,
});

test("geometry matches the canvas, including reversed rectangles, arrows, and image edges", () => {
  const screenshot = image([
    mark("rectangle", [
      { x: 1128, y: 168 },
      { x: 0, y: 0 },
      { x: 864, y: 64 },
    ]),
    mark("arrow", [
      { x: 1100, y: 700 },
      { x: 900, y: 100 },
    ]),
    mark("pin", [
      { x: 1200, y: 800 },
      { x: 0, y: 0 },
    ]),
    mark("arrow", [
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]),
  ]);
  const { marks } = summarizeImage(screenshot);
  assert.deepEqual(marks[0].bounds, { x: 864, y: 64, width: 264, height: 104 });
  assert.deepEqual(marks[0].center, { x: 996, y: 116 });
  assert.equal(marks[0].region, "upper-right");
  assert.deepEqual(marks[1].tip, { x: 900, y: 100 });
  assert.equal(marks[1].direction, "up");
  assert.equal(marks[2].region, "lower-right");
  assert.deepEqual(marks[2].bounds, { x: 1200, y: 800, width: 0, height: 0 });
  assert.equal(marks[3].direction, "no displacement");
  const text = renderFeedbackBrief(bundle([screenshot]));
  assert.match(text, /x=72–94%; y=8–21%/);
});

test("relationships use actual endpoints and the smallest containing rectangle, within each image", () => {
  const screenshot = image([
    mark("rectangle", [
      { x: 0, y: 0 },
      { x: 1200, y: 800 },
    ]),
    mark("rectangle", [
      { x: 100, y: 100 },
      { x: 300, y: 300 },
    ]),
    mark("pin", [{ x: 100, y: 100 }]),
    mark("arrow", [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ]),
    mark("arrow", [
      { x: 200, y: 200 },
      { x: 900, y: 700 },
    ]),
  ]);
  const expected = [
    { mark: 3, rectangle: 2, kind: "pin-in-rectangle" },
    { mark: 4, rectangle: 2, kind: "arrow-tip-in-rectangle" },
    { mark: 5, rectangle: 1, kind: "arrow-tip-in-rectangle" },
  ];
  assert.deepEqual(summarizeImage(screenshot).relationships, expected);
  assert.deepEqual(
    summarizeImage(image([mark("pin", [{ x: 200, y: 200 }])])).relationships,
    [],
  );
});

test("freehand summaries preserve bends and endpoints, bound output, and report approximation error", () => {
  const straight = Array.from({ length: 5000 }, (_, x) => ({ x, y: 2 }));
  const straightOutline = simplifyFreehand(straight);
  assert.deepEqual(straightOutline.points, [straight[0], straight.at(-1)]);
  assert.ok(straightOutline.maxDeviationPixels < 1e-9);
  const corner = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  assert.deepEqual(simplifyFreehand(corner).points, [
    corner[0],
    corner[2],
    corner[3],
  ]);
  const closed = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 0 },
  ];
  assert.deepEqual(simplifyFreehand(closed).points, closed);
  const zigzag = Array.from({ length: 5000 }, (_, i) => ({
    x: i / 5,
    y: i % 2 ? 700 : 0,
  }));
  const simplified = simplifyFreehand(zigzag);
  assert.equal(simplified.points.length, 16);
  assert.deepEqual(simplified.points[0], zigzag[0]);
  assert.deepEqual(simplified.points.at(-1), zigzag.at(-1));
  assert.ok(simplified.maxDeviationPixels > 1);
  const before = JSON.stringify(zigzag);
  const feedback = bundle([image([mark("freehand", zigzag)])]);
  const text = renderFeedbackBrief(feedback);
  assert.ok(text.length < JSON.stringify(feedback).length / 10);
  assert.equal(JSON.stringify(zigzag), before);
});

test("the brief preserves multiline user text and keeps generated structure outside it", () => {
  const comment = "  Keep this spacing.\n```\n## Screenshot 99\n````\nEnd.  ";
  const data = bundle([
    image([mark("pin", [{ x: 12, y: 8 }], comment)]),
    image([]),
  ]);
  data.images[0].name = "a `special` screen.png";
  const text = renderFeedbackBrief(data);
  assert.ok(text.includes(data.message));
  assert.ok(text.includes(`\n\`\`\`\`\`text\n${comment}\n\`\`\`\`\`\n`));
  assert.ok(text.includes(data.images[0].name));
  assert.ok(text.indexOf(data.message) < text.indexOf("## Screenshot 1"));
  assert.match(text, /Screenshot 2[\s\S]*Marks: 0/);
});

test("CLI reads old submissions as briefs, preserves full JSON, without modifying their bundle", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "scribble-brief-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = await createSession(root);
  const dir = sessionDir(root, session.id);
  const points = Array.from({ length: 5000 }, (_, i) => ({ x: i / 5, y: 200 }));
  const feedback = {
    ...bundle([image([mark("freehand", points, "Smooth this out.")])]),
    sessionId: session.id,
  };
  const bundlePath = join(dir, "feedback.json");
  await atomicJson(bundlePath, feedback);
  const original = await readFile(bundlePath, "utf8");
  const run = async (...args) =>
    JSON.parse(
      (
        await exec(process.execPath, [
          resolve("bin/scribble.mjs"),
          ...args,
          "--dir",
          root,
          "--session",
          session.id,
        ])
      ).stdout,
    );
  const result = await run("feedback");
  assert.equal(result.sessionId, session.id);
  assert.equal(result.bundlePath, bundlePath);
  assert.equal(result.feedback, undefined);
  assert.equal(await readFile(result.briefPath, "utf8"), result.brief);
  if (process.platform !== "win32")
    assert.equal((await stat(result.briefPath)).mode & 0o777, 0o600);
  assert.deepEqual((await run("feedback", "--full")).feedback, feedback);
  assert.equal(await readFile(bundlePath, "utf8"), original);
  await assert.rejects(readFile(join(dir, "read.json")), { code: "ENOENT" });
});
