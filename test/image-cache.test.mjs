import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({
  entryPoints: ["src/imageCache.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { createImageCache } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);

test("image consumers share downloads, independent images load together, and failures retry", async () => {
  const requests = [];
  const cache = createImageCache(
    (id) =>
      new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
    () => {},
  );
  const first = cache.load("first");
  assert.equal(cache.load("first"), first);
  const second = cache.load("second");
  assert.deepEqual(
    requests.map((r) => r.id),
    ["first", "second"],
  );
  requests[1].resolve("second-url");
  assert.equal(await second, "second-url");
  requests[0].reject(new Error("Temporary image failure"));
  await assert.rejects(first, /Temporary image failure/);
  assert.equal(cache.get("first").error, "Temporary image failure");
  let notifications = 0;
  const unsubscribe = cache.subscribe(() => notifications++);
  const retried = cache.load("first");
  requests[2].resolve("first-url");
  await retried;
  assert.deepEqual(cache.get("first"), { url: "first-url" });
  assert.equal(notifications, 2);
  unsubscribe();
  cache.dispose();
});

test("disposing an image cache cancels downloads and releases late assets", async () => {
  let finish, signal;
  const released = [];
  const cache = createImageCache(
    (_id, abortSignal) => {
      signal = abortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    (url) => released.push(url),
  );
  const pending = cache.load("late");
  cache.dispose();
  assert.equal(signal.aborted, true);
  finish("late-url");
  await assert.rejects(pending);
  assert.deepEqual(released, ["late-url"]);
});
