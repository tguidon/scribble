import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationPath } from "../src/annotationPath.mjs";
import { frameBatcher } from "../src/frameBatcher.mjs";

test("saved paths are not traversed again when comments, selection, or zoom change", () => {
  let reads = 0;
  const points = new Proxy(
    [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
    {
      get(target, key, receiver) {
        if (key === "0" || key === "1") reads++;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const mark = { points, comment: "" };
  assert.equal(annotationPath(mark.points), "M 1 2 L 3 4");
  const initialReads = reads;
  for (let frame = 0; frame < 120; frame++) {
    const updated = { ...mark, comment: `Edit ${frame}` };
    assert.equal(annotationPath(updated.points), "M 1 2 L 3 4");
  }
  assert.equal(reads, initialReads);
  assert.equal(
    annotationPath([...points, { x: 5, y: 6 }]),
    "M 1 2 L 3 4 L 5 6",
  );
});
test("preview updates commit once per frame and cancellation prevents stale strokes", () => {
  const frames = new Map();
  let next = 0;
  const commits = [];
  const batch = frameBatcher(
    (value) => commits.push(value),
    (fn) => {
      const id = next++;
      frames.set(id, fn);
      return id;
    },
    (id) => frames.delete(id),
  );
  for (let point = 0; point < 100; point++) batch.schedule(point);
  assert.equal(frames.size, 1);
  const callback = frames.values().next().value;
  frames.clear();
  callback();
  assert.deepEqual(commits, [99]);
  batch.schedule(100);
  batch.cancel();
  assert.equal(frames.size, 0);
  assert.deepEqual(commits, [99]);
  batch.schedule(101);
  frames.values().next().value();
  assert.deepEqual(commits, [99, 101]);
});
