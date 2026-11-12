import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readMultipartFrames,
  MAX_FRAME_BYTES,
} from "../skills/scribble/scripts/lib/capture/frame-parser.mjs";

const frame = (value) =>
  Buffer.concat([
    Buffer.from(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${value.length}\r\n\r\n`,
    ),
    value,
    Buffer.from("\r\n"),
  ]);
function stream(chunks, cancel = () => {}) {
  return new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(chunks.shift());
      else controller.close();
    },
    cancel,
  });
}

test("multipart frames survive fragmented headers, bodies, and multiple frames per chunk", async () => {
  const first = Buffer.from([0, 13, 10, 255]);
  const second = Buffer.from("second");
  const bytes = Buffer.concat([frame(first), frame(second)]);
  let cancelled = false;
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
  const parsed = [];
  for await (const value of readMultipartFrames(
    stream(chunks, () => {
      cancelled = true;
    }),
  )) {
    parsed.push(Buffer.from(value));
    if (parsed.length === 2) break;
  }
  assert.deepEqual(parsed, [first, second]);
  assert.equal(cancelled, true);
  const reader = readMultipartFrames(stream([bytes]));
  assert.deepEqual(Buffer.from((await reader.next()).value), first);
  assert.deepEqual(Buffer.from((await reader.next()).value), second);
  await reader.return();
});

test("a maximum-size frame can share its last chunk with the next frame", async () => {
  const large = frame(Buffer.alloc(MAX_FRAME_BYTES, 91));
  const next = Buffer.alloc(16384, 17);
  const split = large.length - 65536;
  const reader = readMultipartFrames(
    stream([
      large.subarray(0, split),
      Buffer.concat([large.subarray(split), frame(next)]),
    ]),
  );
  const first = (await reader.next()).value;
  assert.equal(first.length, MAX_FRAME_BYTES);
  assert.equal(first.at(-1), 91);
  assert.deepEqual(Buffer.from((await reader.next()).value), next);
  await reader.return();
});

for (const [name, bytes, error] of [
  ["missing length", Buffer.from("--frame\r\n\r\n"), /length/],
  [
    "oversized length",
    Buffer.from(`--frame\r\nContent-Length: ${MAX_FRAME_BYTES + 1}\r\n\r\n`),
    /length/,
  ],
  ["oversized header", Buffer.alloc(8193, 65), /header/],
  ["chunk without a header", Buffer.alloc(MAX_FRAME_BYTES + 8193), /header/],
  [
    "truncated body",
    frame(Buffer.from("hello")).subarray(0, -4),
    /disconnected/,
  ],
]) {
  test(`multipart parsing rejects ${name} and releases its reader`, async () => {
    const body = stream([bytes]);
    await assert.rejects(async () => {
      for await (const _ of readMultipartFrames(body)) {
      }
    }, error);
    assert.equal(body.locked, false);
  });
}
