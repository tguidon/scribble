import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export function listeningApps(output, excludedPorts = []) {
  const candidates = new Map();
  let command = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) command = "";
    if (line.startsWith("c")) command = line.slice(1);
    if (!line.startsWith("n")) continue;
    // Inspect development servers, not unrelated OS services or remote hosts.
    if (
      !/node|bun|deno|python|ruby|php|java|vite|next|webpack|http|serve|uvicorn|gunicorn|dotnet|cargo/i.test(
        command,
      )
    )
      continue;
    const match = /^(?:\*|localhost|127\.0\.0\.1|\[::1\]|\[::\]):(\d+)$/.exec(
      line.slice(1),
    );
    if (!match) continue;
    const port = Number(match[1]);
    if (excludedPorts.includes(port) || port < 1 || port > 65535) continue;
    const host = line.includes("[::1]") ? "[::1]" : "127.0.0.1";
    candidates.set(port, { url: `http://${host}:${port}`, process: command });
  }
  return [...candidates.values()].slice(0, 64);
}

async function probe(candidate) {
  try {
    const response = await fetch(candidate.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(1200),
      headers: { Accept: "text/html" },
    });
    if (!response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    try {
      while (size < 32768) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.subarray(0, 32768 - size));
        size += value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const html = Buffer.concat(chunks).toString();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i
      .exec(html)?.[1]
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return {
      ...candidate,
      title: title || `App on port ${new URL(candidate.url).port}`,
    };
  } catch {
    return null;
  }
}

export async function discoverWebApps({ excludePorts = [], list } = {}) {
  let output;
  try {
    output = list
      ? await list()
      : (
          await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], {
            timeout: 3000,
            maxBuffer: 1024 * 1024,
          })
        ).stdout;
  } catch {
    return {
      apps: [],
      message:
        "Automatic discovery is unavailable here. You can still enter any webpage URL.",
    };
  }
  const candidates = listeningApps(output, excludePorts);
  const apps = [];
  for (let i = 0; i < candidates.length; i += 8) {
    apps.push(
      ...(await Promise.all(candidates.slice(i, i + 8).map(probe))).filter(
        Boolean,
      ),
    );
  }
  return { apps: apps.slice(0, 12) };
}
