import assert from "node:assert/strict";
import { test } from "node:test";
import { AndroidCapture } from "../skills/scribble/scripts/lib/capture/android.mjs";

test("Android input targets the selected emulator and scales to the captured display", async () => {
  const serial = "emulator-5558";
  const calls = [];
  const image = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(image);
  image.writeUInt32BE(1080, 16);
  image.writeUInt32BE(1920, 20);
  const capture = new AndroidCapture(async (args) => {
    if (args[0] === "devices") return Buffer.from(serial + " device");
    assert.deepEqual(args.slice(0, 2), ["-s", serial]);
    calls.push(args.slice(2));
    if (args[2] === "exec-out") return image;
    if (args[3] === "dumpsys")
      return Buffer.from(
        "mFocusedApp=ActivityRecord{abc u0 org.example/.Main t2}",
      );
    return Buffer.alloc(0);
  });
  await assert.rejects(capture.open({ deviceId: "emulator-5554" }), {
    status: 409,
  });
  await capture.open({ deviceId: serial });
  await capture.input({ type: "pointer", phase: "down", x: 1, y: 0 });
  await capture.input({ type: "pointer", phase: "move", x: 0, y: 1 });
  await capture.release();
  assert.deepEqual(calls.slice(-3), [
    ["shell", "input", "motionevent", "DOWN", "1079", "0"],
    ["shell", "input", "motionevent", "MOVE", "0", "1919"],
    ["shell", "input", "motionevent", "UP", "0", "1919"],
  ]);
  await capture.input({ type: "text", text: "Bob's $5;%s" });
  assert.deepEqual(calls.at(-1), [
    "shell",
    "input text 'Bob'\\''s%s$5;' && input text '%' && input text 's'",
  ]);
  await assert.rejects(
    capture.input({ type: "text", text: "猫" }),
    /US keyboard/,
  );
  const snapshot = await capture.capture();
  assert.equal(snapshot.source.appPackage, "org.example");
  assert.equal(snapshot.source.orientation, "portrait");
  await capture.close();
  await assert.rejects(capture.capture(), { status: 409 });
});
