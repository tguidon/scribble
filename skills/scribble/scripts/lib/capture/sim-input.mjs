import { setTimeout as delay } from "node:timers/promises";
import { captureError, localUrl } from "./common.mjs";
const keyCodes = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  " ": 44,
  Delete: 76,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  Home: 74,
  End: 77,
  PageUp: 75,
  PageDown: 78,
};
const plain = "-=[]\\;'`,./";
const shifted = '_+{}|:"~<>?';
export function simKey(key) {
  if (keyCodes[key]) return { usage: keyCodes[key], shift: false };
  if (/^[a-z]$/i.test(key))
    return {
      usage: key.toLowerCase().charCodeAt(0) - 93,
      shift: key !== key.toLowerCase(),
    };
  const digits = "1234567890",
    symbols = "!@#$%^&*()";
  const digit = digits.indexOf(key),
    symbol = symbols.indexOf(key);
  if (digit >= 0 || symbol >= 0)
    return { usage: 30 + Math.max(digit, symbol), shift: symbol >= 0 };
  const a = plain.indexOf(key),
    b = shifted.indexOf(key);
  // HID usage 50 is the non-US # key, not part of this layout.
  const usages = [45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56];
  if (a >= 0 || b >= 0) return { usage: usages[Math.max(a, b)], shift: b >= 0 };
  throw captureError(
    "Simulator keyboard input supports US keyboard characters. Use the simulator keyboard for other text.",
  );
}
export class SimulatorInput {
  constructor(url) {
    const parsed = new URL(url);
    if (!["ws:", "wss:"].includes(parsed.protocol))
      throw captureError("Invalid simulator input URL.");
    localUrl(url.replace(/^ws/, "http"));
    this.url = url;
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(
          captureError(
            "Simulator input timed out. Reconnect the simulator.",
            502,
          ),
        );
      }, 4000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(
            captureError(
              "Simulator input disconnected. Reconnect the simulator.",
              502,
            ),
          );
        },
        { once: true },
      );
    });
  }
  send(type, data) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw captureError(
        "Simulator input disconnected. Reconnect the simulator.",
        502,
      );
    this.socket.send(
      Buffer.concat([Buffer.from([type]), Buffer.from(JSON.stringify(data))]),
    );
  }
  async input(input) {
    await this.connect();
    if (input.type === "pointer") {
      const type = { down: "begin", move: "move", up: "end" }[input.phase];
      if (type === "begin") this.touchStarted = Date.now();
      if (type === "end" && this.touchStarted)
        await delay(Math.max(0, 40 - (Date.now() - this.touchStarted)));
      if (type === "begin")
        this.edge =
          input.y > 0.97 ? 3 : input.y < 0.02 ? 2 : input.x < 0.02 ? 1 : 0;
      const point = { x: input.x, y: input.y, edge: this.edge || 0 };
      this.send(3, { type, ...point });
      this.touch = type === "end" ? null : point;
      clearTimeout(this.timer);
      if (this.touch) this.timer = setTimeout(() => this.release(), 10000);
    } else if (input.type === "release") this.release();
    else if (input.type === "home") this.send(4, { button: "home" });
    else if (input.type === "wheel")
      this.send(11, { dx: input.dx, dy: input.dy, x: 0.5, y: 0.5 });
    else if (input.type === "text" || input.type === "key") {
      const keys =
        input.type === "text"
          ? [...input.text.replace(/\r\n/g, "\n")].map((k) =>
              k === "\n" ? "Enter" : k === "\t" ? "Tab" : k,
            )
          : [input.key];
      const mapped = keys.map(simKey); // Validate the whole paste before sending any of it.
      for (const { usage, shift } of mapped) {
        const modifiers = [
          [input.control, 224],
          [input.shift || shift, 225],
          [input.alt, 226],
          [input.meta, 227],
        ].filter(([on]) => on);
        for (const [, code] of modifiers)
          this.send(6, { type: "down", usage: code });
        this.send(6, { type: "down", usage });
        this.send(6, { type: "up", usage });
        for (const [, code] of modifiers.reverse())
          this.send(6, { type: "up", usage: code });
      }
    } else throw captureError("This action is only available for webpages.");
  }
  release() {
    clearTimeout(this.timer);
    if (this.touch && this.socket?.readyState === WebSocket.OPEN)
      this.send(3, { type: "end", ...this.touch });
    this.touch = null;
  }
  close() {
    this.release();
    this.socket?.close();
    this.socket = null;
  }
}
