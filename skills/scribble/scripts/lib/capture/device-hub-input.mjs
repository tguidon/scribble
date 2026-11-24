import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { withLock } from "../lock.mjs";
import { captureError } from "./common.mjs";
import { simKey } from "./sim-input.mjs";

const exec = promisify(execFile);
const version = "2.1.1";
const archive = `AXe-macOS-v${version}-universal.tar.gz`;
const url = `https://github.com/cameroncooke/AXe/releases/download/v${version}/${archive}`;
const digest =
  "8788838b1b32059d143cf06541b72fcaead85c16274457cdbff086510a5b17fa";

async function installedAxe(root) {
  const runtime = join(root, "capture-runtime");
  const directory = join(runtime, `axe-${version}`);
  const binary = join(directory, "axe");
  const installed = () =>
    access(binary).then(
      () => true,
      () => false,
    );
  if (await installed()) return binary;
  await mkdir(runtime, { recursive: true });
  return withLock(runtime, "axe-install.lock", async () => {
    if (await installed()) return binary;
    const temp = await mkdtemp(join(runtime, ".axe-"));
    try {
      const file = join(temp, archive);
      await exec("/usr/bin/curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--proto",
        "=https",
        "--max-time",
        "45",
        "--output",
        file,
        url,
      ]);
      if (
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex") !== digest
      )
        throw new Error("AXe download checksum mismatch.");
      const unpacked = join(temp, "unpacked");
      await mkdir(unpacked);
      await exec("/usr/bin/tar", ["-xzf", file, "-C", unpacked]);
      await rename(unpacked, directory);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    return binary;
  });
}

export class DeviceHubInput {
  static async open(root, device) {
    const input = new DeviceHubInput(await installedAxe(root), device);
    await input.screen();
    return input;
  }
  constructor(binary, device) {
    this.binary = binary;
    this.device = device;
  }
  async run(args) {
    try {
      const { stdout } = await exec(
        this.binary,
        ["--output", "json", ...args].map(String),
        { timeout: 15000 },
      );
      return JSON.parse(stdout);
    } catch {
      throw captureError(
        "Device Hub input failed. Check that the selected simulator is available and the text uses its keyboard layout.",
        502,
      );
    }
  }
  command(...args) {
    return this.run([...args, "--udid", this.device]);
  }
  async screen() {
    const result = await this.command("displays");
    const screen = result.data?.result?.activeScreen;
    if (!(screen?.width > 0 && screen.height > 0))
      throw captureError(
        "Device Hub could not locate the simulator display.",
        502,
      );
    return screen;
  }
  async input(event) {
    if (event.type === "release") return this.release();
    if (event.type === "home") return this.command("button", "home");
    if (event.type === "text")
      return this.run(["type", "--udid", this.device, "--", event.text]);
    if (event.type === "key") {
      const { usage, shift } = simKey(event.key);
      const modifiers = [
        [event.control, 224],
        [event.shift || shift, 225],
        [event.alt, 226],
        [event.meta, 227],
      ]
        .filter(([active]) => active)
        .map(([, code]) => code);
      return modifiers.length
        ? this.command(
            "key-combo",
            "--modifiers",
            modifiers.join(","),
            "--key",
            usage,
          )
        : this.command("key", usage);
    }
    if (event.type === "wheel") {
      if (!event.dx && !event.dy) return;
      const { width, height } = await this.screen();
      const x = width / 2,
        y = height / 2;
      const dx = Math.max(-x + 2, Math.min(x - 2, event.dx));
      const dy = Math.max(-y + 2, Math.min(y - 2, event.dy));
      return this.command(
        "swipe",
        "--start-x",
        x,
        "--start-y",
        y,
        "--end-x",
        x - dx,
        "--end-y",
        y - dy,
        "--duration",
        0.15,
      );
    }
    if (event.type !== "pointer")
      throw captureError("Unsupported simulator input.");
    // Submit one complete gesture so a lost connection cannot leave a finger down.
    if (event.phase === "down") {
      this.stroke = { start: Date.now(), points: [event] };
      return;
    }
    const stroke = this.stroke;
    if (!stroke) return;
    const previous = stroke.points.at(-1);
    if (event.x !== previous.x || event.y !== previous.y) {
      if (stroke.points.length === 1000) stroke.points.splice(1, 1);
      stroke.points.push(event);
    }
    if (event.phase !== "up") return;
    this.release();
    const duration = Math.max(
      0.04,
      Math.min(10, (Date.now() - stroke.start) / 1000),
    );
    const { width, height } = await this.screen();
    const points = stroke.points.map(({ x, y }) => [
      Math.round(x * (width - 1)),
      Math.round(y * (height - 1)),
    ]);
    const [x, y] = points[0];
    if (
      points.every(([px, py]) => Math.abs(px - x) < 3 && Math.abs(py - y) < 3)
    )
      return duration < 0.45
        ? this.command("tap", "-x", x, "-y", y)
        : this.command(
            "touch",
            "-x",
            x,
            "-y",
            y,
            "--down",
            "--up",
            "--delay",
            duration,
          );
    return this.command(
      "draw",
      ...points.map((point) => point.join(",")),
      "--duration",
      duration,
    );
  }
  release() {
    this.stroke = null;
  }
  close() {
    this.release();
  }
}
