import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { captureError } from "./common.mjs";
import { withStartLock } from "../lock.mjs";
const exec = promisify(execFile);
export const CAPTURE_PACKAGES = {
  web: "playwright@1.63.0",
  simulator: "serve-sim@0.1.47",
};
export function runtimeRequire(root) {
  return createRequire(join(root, "capture-runtime/package.json"));
}
export function playwright(root) {
  for (const require of [
    runtimeRequire(root),
    createRequire(import.meta.url),
  ]) {
    try {
      return require("playwright");
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw captureError(
    "Webpage capture needs a one-time setup. Ask your agent to run Scribble setup web.",
    503,
  );
}
export function setupCommand(root, kind) {
  const cli = fileURLToPath(new URL("../../scribble.mjs", import.meta.url));
  // Display only: callers pass arguments directly, never through a shell.
  return `node ${JSON.stringify(cli)} setup ${kind} --dir ${JSON.stringify(root)}`;
}
export async function simCommand(root) {
  try {
    const entry = runtimeRequire(root).resolve("serve-sim/middleware");
    return {
      file: process.execPath,
      args: [join(dirname(entry), "serve-sim.js")],
    };
  } catch {}
  try {
    await exec("serve-sim", ["--help"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return { file: "serve-sim", args: [] };
  } catch {}
  throw captureError(
    "Simulator capture needs serve-sim. Ask your agent to run Scribble setup simulator.",
    503,
  );
}
function run(file, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", env, shell: false });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Capture setup exited with code ${code}. Retry setup to continue.`,
            ),
          ),
    );
  });
}
export async function setupCapture(root, kind) {
  if (!Object.hasOwn(CAPTURE_PACKAGES, kind))
    throw new Error("Choose setup web or setup simulator.");
  if (
    kind === "simulator" &&
    (process.platform !== "darwin" || process.arch !== "arm64")
  )
    throw new Error("serve-sim requires an Apple Silicon Mac with Xcode.");
  const dir = join(root, "capture-runtime");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install",
    "--prefix",
    dir,
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--save-exact",
    CAPTURE_PACKAGES[kind],
  ]);
  if (kind === "web") {
    const require = runtimeRequire(root);
    const cli = join(
      dirname(require.resolve("playwright/package.json")),
      "cli.js",
    );
    await run(process.execPath, [cli, "install", "chromium"]);
  }
}

// Serialize package changes across sessions and CLI setup without duplicate downloads.
const preparations = new Map();
export async function ensureCapture(root, kind) {
  const available = async () => {
    try {
      if (kind === "web") playwright(root);
      else await simCommand(root);
      return true;
    } catch {
      return false;
    }
  };
  if (await available()) return;
  const key = `${root}:${kind}`;
  if (!preparations.has(key)) {
    const task = withStartLock(root, async () => {
      if (!(await available())) {
        try {
          await setupCapture(root, kind);
        } catch {
          throw captureError(
            `Could not install the capture tools. Check your internet connection and retry, or run: ${setupCommand(root, kind)}`,
            503,
          );
        }
      }
    }).finally(() => preparations.delete(key));
    preparations.set(key, task);
  }
  return preparations.get(key);
}
