import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simCommand } from "./runtime.mjs";
import { localUrl, imageDimensions, captureError } from "./common.mjs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SimulatorInput } from "./sim-input.mjs";
import { validateInput } from "./live.mjs";
const exec = promisify(execFile);

export async function bootedDevices() {
  if (process.platform !== "darwin")
    throw captureError("Simulator capture requires a Mac with Xcode.", 503);
  let result;
  try {
    result = await exec(
      "xcrun",
      ["simctl", "list", "devices", "booted", "-j"],
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch {
    throw captureError(
      "Xcode could not list simulators. Open Simulator and boot a device, then refresh.",
      503,
    );
  }
  return Object.values(JSON.parse(result.stdout).devices)
    .flat()
    .filter((d) => d.state === "Booted" && d.isAvailable)
    .map((d) => ({ id: d.udid, name: d.name }));
}

// Consume one complete frame, then cancel the continuous stream immediately.
export async function readFrame(url) {
  const response = await fetch(localUrl(url), {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.body)
    throw captureError(
      "The simulator stream is unavailable. Reconnect the simulator.",
      502,
    );
  const reader = response.body.getReader();
  let buffer = Buffer.alloc(0),
    headerEnd = -1,
    length;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw captureError(
          "The simulator stream ended before a frame arrived. Reconnect and try again.",
          502,
        );
      buffer = Buffer.concat([buffer, value]);
      if (headerEnd < 0) {
        headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd >= 0) {
          const match = /content-length:\s*(\d+)/i.exec(
            buffer.toString("ascii", 0, headerEnd),
          );
          length = Number(match?.[1]);
          if (!length || length > 20 * 1024 * 1024)
            throw captureError(
              "The simulator returned an invalid or oversized frame.",
              502,
            );
        } else if (buffer.length > 8192)
          throw captureError(
            "The simulator returned an invalid stream header.",
            502,
          );
      }
      if (headerEnd >= 0 && buffer.length >= headerEnd + 4 + length) {
        const bytes = buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
        imageDimensions(bytes);
        return bytes;
      }
      if (buffer.length > 20 * 1024 * 1024 + 8192)
        throw captureError("The simulator frame exceeds 20 MB.", 502);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class SimulatorCapture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.connection = null;
  }
  state() {
    return this.connection
      ? {
          connected: true,
          generation: this.generation || 0,
          inputWarning: this.inputWarning || undefined,
          device: this.connection.device,
          previewUrl: this.connection.previewUrl,
        }
      : { connected: false };
  }
  async devices() {
    return (this.options.devices || bootedDevices)();
  }
  async run(args) {
    const command = this.options.command || (await simCommand(this.root));
    try {
      const { stdout } = await exec(command.file, [...command.args, ...args], {
        timeout: 25000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      if (error.status) throw error;
      throw captureError(
        "serve-sim could not connect. Check that the simulator is booted, then try again.",
        502,
      );
    }
  }
  async open(input) {
    if (
      typeof input.deviceId !== "string" ||
      !/^[a-f\d-]{36}$/i.test(input.deviceId)
    )
      throw captureError("Choose a booted simulator.");
    const device = (await this.devices()).find((d) => d.id === input.deviceId);
    if (!device)
      throw captureError(
        "That simulator is no longer booted. Refresh the device list.",
        409,
      );
    await this.close();
    this.generation = (this.generation || 0) + 1;
    const result = await this.run(["--detach", "-q", device.id]);
    if (result.device !== device.id || !result.streamUrl || !result.url)
      throw captureError(
        "serve-sim returned a different device or no stream. Update serve-sim and try again.",
        502,
      );
    const stream = localUrl(result.streamUrl);
    const preview = localUrl(result.url);
    preview.searchParams.set("device", device.id);
    const wsUrl =
      result.wsUrl || new URL("ws", stream).href.replace(/^http/, "ws");
    this.controls = new SimulatorInput(wsUrl);
    this.connection = {
      device,
      streamUrl: stream.href,
      previewUrl: preview.href,
    };
    this.inputWarning = "";
    if (!this.options.command) {
      const flag = await exec(
        "xcrun",
        [
          "simctl",
          "spawn",
          device.id,
          "notifyutil",
          "-g",
          "com.apple.coredevice.dtuhidd.active",
        ],
        { timeout: 4000 },
      ).catch(() => null);
      if (flag?.stdout.trim() === "com.apple.coredevice.dtuhidd.active 1")
        this.inputWarning =
          "Xcode Device Hub has disabled touch and keyboard input for this simulator. You can still capture its screen. Ask your agent to repair simulator input; the repair closes running apps. Then reconnect here.";
    }
    return this.state();
  }
  async capture() {
    if (!this.connection)
      throw captureError("Connect a simulator before capturing it.", 409);
    const { device, streamUrl } = this.connection;
    const endpoint = (name) => new URL(name, streamUrl).href;
    const info = async (name) => {
      const response = await fetch(localUrl(endpoint(name)), {
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok)
        throw captureError(
          "The simulator disconnected. Reconnect and try again.",
          502,
        );
      return response.json();
    };
    try {
      const before = await info("config");
      const bytes = await readFrame(streamUrl);
      const config = await info("config");
      if (before.orientation !== config.orientation)
        throw captureError(
          "The simulator rotated during capture. Capture again once it settles.",
          409,
        );
      const foreground = await info("foreground").catch(() => null);
      return {
        bytes,
        ...imageDimensions(bytes),
        name: `${device.name}.jpg`,
        source: {
          kind: "simulator",
          provider: "serve-sim",
          device,
          orientation: String(config.orientation || "unknown"),
          ...(foreground?.bundleId
            ? { appBundleId: String(foreground.bundleId).slice(0, 300) }
            : {}),
          capturedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error.status) throw error;
      throw captureError(
        "No simulator frame arrived. Reopen the live preview, then reconnect and try again.",
        502,
      );
    }
  }
  async stream(res) {
    if (!this.connection)
      throw captureError("Connect a simulator before viewing it.", 409);
    this.stopStream?.();
    const abort = new AbortController();
    const stop = () => {
      abort.abort();
      res.end();
    };
    this.stopStream = stop;
    res.once("close", stop);
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(localUrl(this.connection.streamUrl), {
        signal: abort.signal,
        redirect: "error",
      });
      clearTimeout(timer);
      const type = response.headers.get("content-type");
      if (
        !response.ok ||
        !response.body ||
        !type?.startsWith("multipart/x-mixed-replace")
      )
        throw captureError(
          "The simulator stream disconnected. Reconnect and try again.",
          502,
        );
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      void pipeline(Readable.fromWeb(response.body), res)
        .catch(() => {})
        .finally(() => {
          abort.abort();
          if (this.stopStream === stop) this.stopStream = null;
        });
    } catch (error) {
      clearTimeout(timer);
      abort.abort();
      throw error;
    }
  }
  async input(raw) {
    const input = validateInput(raw);
    if (!this.connection)
      throw captureError("Reconnect the simulator to interact with it.", 409);
    if (this.inputWarning && !["home", "release"].includes(input.type))
      throw captureError(this.inputWarning, 409);
    await this.controls.input(input);
    return this.state();
  }
  async release() {
    this.controls?.release();
  }
  async close() {
    this.stopStream?.();
    this.controls?.close();
    this.connection = null;
  }
}
