import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { withLock } from "../lock.mjs";
import { captureError } from "./common.mjs";
import { TouchChannel } from "./touch-channel.mjs";
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
    const input = new DeviceHubInput(root, device);
    input.channel = await TouchChannel.open(root, device);
    return input;
  }
  constructor(root, device) {
    this.root = root;
    this.device = device;
  }
  async run(args) {
    this.binary ??= await installedAxe(this.root);
    try {
      const { stdout } = await exec(
        this.binary,
        ["--output", "json", ...args].map(String),
        { timeout: 15000 },
      );
      return JSON.parse(stdout);
    } catch {
      throw captureError(
        args[0] === "type"
          ? "The simulator could not type that text with its current keyboard layout."
          : "The simulator could not complete the " + args[0] + " command.",
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
      // Older open editors send one wheel distance rather than pointer phases.
      if (Math.hypot(dx, dy) < 1) return;
      await this.input({ type: "pointer", phase: "down", x: 0.5, y: 0.5 });
      try {
        await this.input({
          type: "pointer",
          phase: "move",
          x: (x - dx) / width,
          y: (y - dy) / height,
        });
      } finally {
        await this.release();
      }
    }
    if (event.type !== "pointer")
      throw captureError("Unsupported simulator input.");
    if (event.phase === "down") {
      await this.release();
      // Resolve orientation at gesture boundaries, never halfway through a drag.
      this.rotation = await this.orientation?.();
      this.started = performance.now();
    } else if (!this.contact) return;
    let { x, y } = event;
    if (this.rotation === "landscape_left") [x, y] = [1 - y, x];
    if (this.rotation === "landscape_right") [x, y] = [y, 1 - x];
    if (this.rotation === "portrait_upside_down") [x, y] = [1 - x, 1 - y];
    const phase = { down: "d", move: "m", up: "u" }[event.phase];
    if (phase === "u") {
      const remaining = 18 - (performance.now() - this.started);
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    this.contact = [x, y];
    await this.channel.send(phase, x, y);
    if (phase === "u") this.contact = null;
  }
  async release() {
    const point = this.contact;
    this.contact = null;
    if (point) await this.channel.send("u", ...point);
  }
  close() {
    this.contact = null;
    this.channel?.close();
  }
}
