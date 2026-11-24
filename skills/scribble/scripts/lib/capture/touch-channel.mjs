import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withLock } from "../lock.mjs";
import { captureError } from "./common.mjs";

const exec = promisify(execFile);
const source = fileURLToPath(new URL("./simulator-touch.m", import.meta.url));

async function executable(root) {
  const directory = join(root, "capture-runtime");
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, 16);
  const binary = join(directory, `simulator-touch-${process.arch}-${hash}`);
  await mkdir(directory, { recursive: true });
  return withLock(directory, "touch-install.lock", async () => {
    if (
      await access(binary).then(
        () => true,
        () => false,
      )
    )
      return binary;
    const temp = await mkdtemp(join(directory, ".touch-"));
    try {
      const output = join(temp, "touch");
      await exec(
        "/usr/bin/xcrun",
        [
          "clang",
          "-O2",
          "-fobjc-arc",
          "-framework",
          "Foundation",
          source,
          "-o",
          output,
        ],
        { timeout: 45000 },
      );
      await rename(output, binary);
      return binary;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}

// The capture manager serializes input. One reply acknowledges each dispatched
// sample, so a stalled simulator can never accumulate a queue in the helper.
export class TouchChannel {
  static async open(root, device) {
    const binary = await executable(root);
    const developerDir =
      process.env.DEVELOPER_DIR ||
      (await exec("/usr/bin/xcode-select", ["-p"])).stdout.trim();
    const channel = new TouchChannel(binary, device, developerDir);
    await channel.connect();
    return channel;
  }
  constructor(binary, device, developerDir) {
    this.args = [device, developerDir];
    this.binary = binary;
  }
  async connect() {
    if (this.child) return;
    const child = spawn(this.binary, this.args, {
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.child = child;
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      this.pending?.reject(
        captureError("The simulator touch connection was interrupted.", 502),
      );
    };
    child.on("error", failed);
    child.once("exit", failed);
    child.stdin.on("error", failed);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (this.child === child && line === this.pending?.expected)
        this.pending.resolve();
    });
    await this.reply("ready");
  }
  reply(expected) {
    const child = this.child;
    return new Promise((resolve, reject) => {
      const finish = (callback) => (value) => {
        clearTimeout(timer);
        this.pending = null;
        callback(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        this.child = null;
        this.pending.reject(
          captureError("The simulator touch connection timed out.", 502),
        );
      }, 4000);
      this.pending = {
        expected,
        resolve: finish(resolve),
        reject: finish(reject),
      };
    });
  }
  async send(phase, x, y) {
    await this.connect();
    const done = this.reply("ok");
    this.child.stdin.write(`${phase} ${x} ${y}\n`);
    await done;
  }
  close() {
    // EOF lets the helper lift its contact before it exits.
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    const deadline = setTimeout(() => child.kill(), 1500);
    deadline.unref();
    child.once("exit", () => clearTimeout(deadline));
  }
}
