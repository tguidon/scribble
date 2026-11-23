import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { simMiddlewareEntry } from "./runtime.mjs";
import { captureError } from "./common.mjs";

const worker = fileURLToPath(
  new URL("./simulator-helper-worker.mjs", import.meta.url),
);

export class SimulatorHelpers {
  constructor(root) {
    this.root = root;
    this.workers = new Map();
  }

  start(device) {
    const current = this.workers.get(device);
    if (current) return current.ready;
    const child = fork(worker, [simMiddlewareEntry(this.root), device], {
      execArgv: [],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const ready = new Promise((resolve, reject) => {
      const failed = () => {
        clearTimeout(timer);
        if (this.workers.get(device)?.child === child)
          this.workers.delete(device);
        reject(
          captureError(
            "The simulator helper could not start. Try reconnecting.",
            502,
          ),
        );
      };
      const timer = setTimeout(() => {
        failed();
        child.kill();
      }, 5000);
      child.once("error", failed);
      child.once("exit", failed);
      child.once("message", (port) => {
        clearTimeout(timer);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          failed();
          child.kill();
          return;
        }
        const path = `127.0.0.1:${port}/helper/${device}`;
        resolve({
          device,
          url: `http://127.0.0.1:${port}/`,
          streamUrl: `http://${path}/stream.mjpeg`,
          wsUrl: `ws://${path}/ws`,
        });
      });
    });
    this.workers.set(device, { child, ready });
    return ready;
  }

  async stop(device) {
    const current = this.workers.get(device);
    if (!current) return;
    const { child } = current;
    const exited = once(child, "exit").catch(() => {});
    child.kill();
    await exited;
  }

  async close() {
    await Promise.all([...this.workers.keys()].map((id) => this.stop(id)));
  }
}
