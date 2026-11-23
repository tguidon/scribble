import { readMultipartFrames } from "./frame-parser.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simCommand } from "./runtime.mjs";
import { localUrl, imageDimensions, captureError } from "./common.mjs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { SimulatorInput } from "./sim-input.mjs";
import { validateInput } from "./contracts.mjs";
const exec = promisify(execFile);

async function deviceHubShadowsInput(deviceId) {
  const flag = "com.apple.coredevice.dtuhidd.active";
  const result = await exec(
    "xcrun",
    ["simctl", "spawn", deviceId, "notifyutil", "-g", flag],
    { timeout: 4000 },
  ).catch(() => null);
  return result?.stdout.trim() === `${flag} 1`;
}

async function runningGuestJob(device, job, signal) {
  const result = await exec(
    "xcrun",
    [
      "simctl",
      "spawn",
      device,
      "launchctl",
      "print",
      `user/foreground/com.apple.${job}`,
    ],
    { signal, timeout: 3000 },
  ).catch(() => null);
  if (/^\s*state = running$/m.test(result?.stdout ?? ""))
    return result.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
}

async function waitForSimulatorReady(device, previousPid) {
  const signal = AbortSignal.timeout(15000);
  while (!signal.aborted) {
    const [backboard, springBoard, display] = await Promise.all([
      runningGuestJob(device, "backboardd", signal),
      runningGuestJob(device, "SpringBoard", signal),
      exec("xcrun", ["simctl", "io", device, "enumerate"], {
        signal,
        timeout: 3000,
      }).catch(() => null),
    ]);
    if (
      backboard &&
      backboard !== previousPid &&
      springBoard &&
      display?.stdout.includes("com.apple.framebuffer.display")
    )
      return;
    await delay(300, undefined, { signal }).catch(() => {});
  }
  throw captureError(
    "The simulator is still starting after input repair. Choose Reconnect to try again.",
    503,
  );
}

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
      "Xcode could not list simulators. Boot a device in Xcode, then refresh.",
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
  try {
    for await (const bytes of readMultipartFrames(response.body)) {
      const frame = Buffer.from(bytes);
      imageDimensions(frame);
      return frame;
    }
  } catch (error) {
    if (error.status) throw error;
    throw captureError(error.message, 502);
  }
}
export class SimulatorCapture {
  constructor(root, options = {}) {
    this.root = root;
    this.generation = 0;
    this.options = options;
    this.connection = null;
  }
  /** @returns {import("./contracts.mjs").SimulatorConnection} */
  state() {
    return this.connection
      ? {
          kind: "simulator",
          connected: true,
          generation: this.generation,
          inputWarning: this.inputWarning || undefined,
          device: this.connection.device,
          previewUrl: this.connection.previewUrl,
        }
      : { kind: "simulator", connected: false };
  }
  async devices() {
    return (this.options.devices || bootedDevices)();
  }
  async run(args, { json = true, failure } = {}) {
    const command = this.options.command || simCommand(this.root);
    try {
      const { stdout } = await exec(command.file, [...command.args, ...args], {
        timeout: 25000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return json ? JSON.parse(stdout) : stdout;
    } catch (error) {
      if (error.status) throw error;
      throw captureError(
        failure ||
          "serve-sim could not connect. Check that the simulator is booted, then try again.",
        502,
      );
    }
  }
  async refreshInputWarning(deviceId) {
    const checkInput =
      this.options.inputShadowed ||
      (this.options.command ? () => false : deviceHubShadowsInput);
    this.inputWarning = (await checkInput(deviceId))
      ? "Device Hub is blocking touch and keyboard input in Scribble. You can still capture the simulator screen."
      : undefined;
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
    if (this.pendingRepair?.deviceId === device.id) {
      const waitForReady = this.options.waitForReady || waitForSimulatorReady;
      await waitForReady(device.id, this.pendingRepair.previousPid);
      if (this.options.command) await this.run(["--kill", device.id]);
      else await this.options.helpers.stop(device.id);
      this.pendingRepair = undefined;
    }
    await this.close();
    this.generation = this.generation + 1;
    const result = this.options.command
      ? await this.run(["--detach", "-q", device.id])
      : await this.options.helpers.start(device.id);
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
    await this.refreshInputWarning(device.id);
    return this.state();
  }
  async repairInput() {
    if (!this.connection || !this.inputWarning)
      throw captureError(
        "The connected simulator does not need input repair.",
        409,
      );
    const deviceId = this.connection.device.id;
    if (this.pendingRepair?.deviceId === deviceId)
      return this.open({ deviceId });
    const previousPid = await (this.options.backboardPid
      ? this.options.backboardPid(deviceId)
      : runningGuestJob(deviceId, "backboardd"));
    const result = await this.run(["repair-input", "-d", deviceId], {
      json: false,
      failure:
        "Scribble could not repair simulator input. Check that the simulator is still booted and try again.",
    });
    if (
      result.startsWith(
        "Input is not shadowed by Device Hub; no restart needed.",
      )
    ) {
      await this.refreshInputWarning(deviceId);
      return this.state();
    }
    if (!result.startsWith("Input repaired."))
      throw captureError(
        "serve-sim did not report whether input was repaired. Try reconnecting.",
        502,
      );
    this.pendingRepair = { deviceId, previousPid };
    return this.open({ deviceId });
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
