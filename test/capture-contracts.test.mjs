import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  validateInput,
  validateCaptureCommand,
} from "../skills/scribble/scripts/lib/capture/contracts.mjs";

test("capture contracts reject invalid combinations at compile time", async () => {
  await promisify(execFile)(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--allowJs",
    "--skipLibCheck",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--target",
    "es2022",
    "test/capture-contracts.typecheck.ts",
  ]);
});

test("capture commands validate and normalize their boundary before dispatch", () => {
  assert.deepEqual(
    validateCaptureCommand("input", {
      kind: "web",
      generation: 4,
      type: "pointer",
      phase: "down",
      x: 0.5,
      y: 1,
      unexpected: "discard",
    }),
    {
      action: "input",
      kind: "web",
      generation: 4,
      type: "pointer",
      phase: "down",
      x: 0.5,
      y: 1,
    },
  );
  assert.deepEqual(
    validateCaptureCommand("open", { kind: "web", url: "localhost:3000" }),
    {
      action: "open",
      kind: "web",
      url: "localhost:3000",
      width: 1280,
      height: 900,
    },
  );
  for (const [action, body] of [
    ["input", { kind: "web", type: "release" }],
    ["input", { kind: "web", generation: 1, type: "home" }],
    ["input", { kind: "simulator", generation: 1, type: "back" }],
    ["resize", { kind: "simulator", generation: 1, width: 390, height: 844 }],
    ["resize", { kind: "web", generation: 1, width: 1, height: 844 }],
    ["open", { kind: "web" }],
    ["open", { kind: "simulator", deviceId: "invalid" }],
    ["focus", { kind: "simulator" }],
    ["unknown", { kind: "web" }],
    ["input", null],
  ])
    assert.throws(
      () => validateCaptureCommand(action, body),
      (error) => error.status === 400,
    );
  for (const input of [
    null,
    {},
    { type: "pointer", phase: "down", x: NaN, y: 0 },
    { type: "wheel", dx: 0 },
    { type: "key", key: "A", meta: "yes" },
    { type: "key", key: "unsupported" },
    { type: "text", text: "x".repeat(4001) },
  ])
    assert.throws(
      () => validateInput(input),
      (error) => error.status === 400,
    );
});
