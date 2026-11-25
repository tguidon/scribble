import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { captureError, imageDimensions } from "./common.mjs";
import { streamHeaders, writeFrame } from "./live.mjs";
import { emulatorId } from "./contracts.mjs";

const exec = promisify(execFile);

export function findAdb() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  ];
  for (const dir of [
    ...(process.env.PATH || "").split(delimiter),
    ...sdkRoots.filter(Boolean).map((root) => join(root, "platform-tools")),
  ].filter(Boolean)) {
    const file = join(dir, process.platform === "win32" ? "adb.exe" : "adb");
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {}
  }
}

export async function adb(args, signal) {
  const file = findAdb();
  if (!file)
    throw captureError(
      "Install Android SDK Platform-Tools and refresh sources.",
      503,
    );
  try {
    const { stdout } = await exec(file, args, {
      signal,
      timeout: 12000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: "buffer",
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw captureError(
      "ADB could not reach the emulator. Check adb devices and reconnect.",
      502,
    );
  }
}

export async function androidDevices(run = adb) {
  const list = await run(["devices", "-l"]);
  const devices = list
    .toString()
    .split(/\r?\n/)
    .flatMap((line) => {
      const [id, state] = line.trim().split(/\s+/);
      if (!emulatorId.test(id) || state !== "device") return [];
      const model = /\bmodel:(\S+)/.exec(line)?.[1].replaceAll("_", " ");
      return [{ id, name: `${model || "Android"} (${id})` }];
    });
  return Promise.all(
    devices.map(async (device) => {
      const result = await run(["-s", device.id, "emu", "avd", "name"]).catch(
        () => null,
      );
      const [name, ok] = result?.toString().trim().split(/\r?\n/) || [];
      return ok === "OK" && name
        ? {
            ...device,
            name: name.replaceAll("_", " ") + " (" + device.id + ")",
          }
        : device;
    }),
  );
}

const keys = {
  Enter: "ENTER",
  Tab: "TAB",
  Backspace: "DEL",
  Delete: "FORWARD_DEL",
  Escape: "BACK",
  Home: "MOVE_HOME",
  End: "MOVE_END",
  PageUp: "PAGE_UP",
  PageDown: "PAGE_DOWN",
  ArrowLeft: "DPAD_LEFT",
  ArrowRight: "DPAD_RIGHT",
  ArrowUp: "DPAD_UP",
  ArrowDown: "DPAD_DOWN",
};

// adb shell joins its arguments before invoking the Android shell.
function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export class AndroidCapture {
  constructor(run = adb) {
    this.run = run;
    this.generation = 0;
  }
  state() {
    return this.device
      ? {
          kind: "simulator",
          connected: true,
          generation: this.generation,
          device: this.device,
        }
      : { kind: "simulator", connected: false };
  }
  async open({ deviceId }) {
    const device = (await androidDevices(this.run)).find(
      (item) => item.id === deviceId,
    );
    if (!device)
      throw captureError(
        "That Android emulator is offline. Refresh the device list.",
        409,
      );
    const bytes = await this.run([
      "-s",
      device.id,
      "exec-out",
      "screencap",
      "-p",
    ]);
    this.size = imageDimensions(bytes);
    this.device = device;
    this.generation++;
    return this.state();
  }
  command(args, signal) {
    if (!this.device)
      throw captureError("Connect an Android emulator first.", 409);
    return this.run(["-s", this.device.id, ...args], signal);
  }
  async frame(signal) {
    const bytes = await this.command(["exec-out", "screencap", "-p"], signal);
    this.size = imageDimensions(bytes);
    return bytes;
  }
  async capture() {
    const bytes = await this.frame();
    const { width, height } = imageDimensions(bytes);
    const windows = await this.command(["shell", "dumpsys", "window"]).catch(
      () => null,
    );
    const appPackage =
      /m(?:CurrentFocus|FocusedApp)=[^\n]*?\bu\d+ ([\w.]+)\//.exec(
        windows?.toString() || "",
      )?.[1];
    return {
      bytes,
      width,
      height,
      name: this.device.name + ".png",
      source: {
        kind: "simulator",
        provider: "adb",
        device: this.device,
        ...(appPackage && { appPackage }),
        orientation: width > height ? "landscape" : "portrait",
        capturedAt: new Date().toISOString(),
      },
    };
  }
  async stream(res) {
    this.stopStream?.();
    const abort = new AbortController();
    const stop = () => {
      if (abort.signal.aborted) return;
      abort.abort();
      if (this.stopStream === stop) this.stopStream = null;
      res.end();
    };
    this.stopStream = stop;
    res.once("close", stop);
    try {
      const first = await this.frame(abort.signal);
      if (abort.signal.aborted) return;
      streamHeaders(res);
      writeFrame(res, first);
    } catch (error) {
      res.off("close", stop);
      if (this.stopStream === stop) this.stopStream = null;
      throw error;
    }
    const poll = async () => {
      while (!abort.signal.aborted) {
        await delay(100, undefined, { signal: abort.signal });
        if (res.writableNeedDrain) continue;
        const bytes = await this.frame(abort.signal);
        if (!abort.signal.aborted) writeFrame(res, bytes);
      }
    };
    void poll().catch(stop);
  }
  async input(event) {
    const send = (...args) => this.command(["shell", "input", ...args]);
    if (event.type === "pointer") {
      const point = [
        Math.round(event.x * (this.size.width - 1)),
        Math.round(event.y * (this.size.height - 1)),
      ].map(String);
      if (event.phase === "down" || this.contact) {
        await send("motionevent", event.phase.toUpperCase(), ...point);
        clearTimeout(this.releaseTimer);
        this.contact = event.phase === "up" ? null : point;
        if (this.contact)
          this.releaseTimer = setTimeout(
            () => void this.release().catch(() => {}),
            10000,
          );
      }
    } else if (event.type === "release") await this.release();
    else if (event.type === "home") await send("keyevent", "HOME");
    else if (event.type === "wheel") {
      const { width, height } = this.size;
      const x = Math.floor(width / 2),
        y = Math.floor(height / 2);
      await send(
        "swipe",
        ...[
          x,
          y,
          Math.max(0, Math.min(width - 1, Math.round(x - event.dx))),
          Math.max(0, Math.min(height - 1, Math.round(y - event.dy))),
          180,
        ].map(String),
      );
    } else if (event.type === "key" && Object.hasOwn(keys, event.key)) {
      await send("keyevent", keys[event.key]);
    } else {
      const text = event.type === "key" ? event.key : event.text;
      if (
        event.meta ||
        event.control ||
        event.alt ||
        /[^\x20-\x7e\r\n\t]/.test(text)
      )
        throw captureError(
          "Android text input supports US keyboard characters.",
        );
      // Send literal percent signs separately so adb cannot interpret a pasted %s as a space.
      const commands = [];
      for (const part of text
        .replaceAll("\r\n", "\n")
        .match(/[^%\n\r\t]+|[%\n\r\t]/g) || []) {
        if (/[\n\r\t]/.test(part))
          commands.push(
            part === "\t" ? "input keyevent TAB" : "input keyevent ENTER",
          );
        else
          commands.push("input text " + shellQuote(part.replaceAll(" ", "%s")));
      }
      if (commands.length) await this.command(["shell", commands.join(" && ")]);
    }
    return this.state();
  }
  async release() {
    clearTimeout(this.releaseTimer);
    if (this.contact) {
      const point = this.contact;
      this.contact = null;
      await this.command(["shell", "input", "motionevent", "UP", ...point]);
    }
  }
  async close() {
    this.stopStream?.();
    await this.release().catch(() => {});
    this.device = null;
  }
}
