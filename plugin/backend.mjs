import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, stat, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createSession,
  loadSession,
  sessionDir,
  atomicJson,
  readJson,
  safeId,
} from "../skills/scribble/scripts/lib/store.mjs";
import { serverHealth } from "../skills/scribble/scripts/lib/lifecycle.mjs";
import {
  VERSION,
  SERVER_PROTOCOL,
} from "../skills/scribble/scripts/lib/version.mjs";
import { prepareHandoff } from "../skills/scribble/scripts/lib/handoff.mjs";

const exec = promisify(execFile);
const launcher = fileURLToPath(
  new URL("../skills/scribble/scripts/scribble.mjs", import.meta.url),
);
// A registry permits old canvases to survive MCP reconnections without accepting
// arbitrary filesystem paths from the UI or exposing a global "latest" session.
export class PluginBackend {
  constructor({
    directory = process.env.SCRIBBLE_PLUGIN_DATA ||
      process.env.PLUGIN_DATA ||
      join(homedir(), ".local", "share", "scribble-plugin"),
  } = {}) {
    this.directory = directory;
    this.starts = new Map();
  }
  async register(root, id) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicJson(join(this.directory, `${id}.json`), { root });
  }
  async lookup(id) {
    if (!safeId(id)) throw new Error("Invalid canvas ID.");
    const record = await readJson(join(this.directory, `${id}.json`)).catch(
      () => null,
    );
    if (!record)
      throw new Error(
        "Canvas not found in this plugin installation. Open Scribble from this chat.",
      );
    return { root: record.root, session: await loadSession(record.root, id) };
  }
  async open(projectPath, title) {
    if (!isAbsolute(projectPath))
      throw new Error("Use the absolute path of the user's project.");
    const project = await realpath(projectPath);
    if (!(await stat(project)).isDirectory())
      throw new Error("Choose a project directory.");
    const root = join(project, ".scribble");
    const session = await createSession(root, title);
    await this.register(root, session.id);
    return this.connection(session.id);
  }
  async connection(id) {
    const { root, session } = await this.lookup(id);
    if (!this.starts.has(root)) {
      const pending = (async () => {
        const existing = await readJson(join(root, "server.json")).catch(
          () => null,
        );
        const health =
          existing && (await serverHealth(existing).catch(() => null));
        if (health?.version === VERSION && health.protocol === SERVER_PROTOCOL)
          return existing;
        const { stdout } = await exec(
          process.execPath,
          [
            launcher,
            "start",
            "--detach",
            "--no-open",
            "--dir",
            root,
            "--session",
            id,
          ],
          { timeout: 30000, maxBuffer: 1024 * 1024 },
        );
        return JSON.parse(stdout);
      })();
      this.starts.set(root, pending);
      pending.finally(() => this.starts.delete(root)).catch(() => {});
    }
    const info = await this.starts.get(root);
    const origin = new URL(info.url).origin;
    return {
      sessionId: id,
      token: session.token,
      origin,
      url: `${origin}/#token=${session.token}&session=${id}`,
    };
  }
  async authorize(id, token) {
    const record = await this.lookup(id);
    if (typeof token !== "string" || token !== record.session.token)
      throw new Error(
        "This canvas connection is invalid. Reopen it from the chat.",
      );
    return record;
  }
  async request(id, token, path, method = "GET", data, binary = false) {
    await this.authorize(id, token);
    const url = new URL(path, "http://scribble.invalid");
    const routes = {
      GET: /^\/(session|health|handoff|feedback|images\/[a-zA-Z0-9-]+|capture\/(status|apps|devices))$/,
      PUT: /^\/draft$/,
      POST: /^\/(sessions|submit|images|capture\/(shared|snapshot|input|open|focus|disconnect))$/,
    };
    if (
      !path.startsWith("/") ||
      url.origin !== "http://scribble.invalid" ||
      !routes[method]?.test(url.pathname)
    )
      throw new Error("Unsupported editor operation.");
    // Credentials are always supplied by this adapter, never forwarded from a URL.
    for (const key of ["token", "session", "version"])
      url.searchParams.delete(key);
    const connection = await this.connection(id);
    const response = await fetch(
      `${connection.origin}/api${url.pathname}${url.search}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Scribble-Session": id,
          "Content-Type": binary
            ? "application/octet-stream"
            : "application/json",
        },
        body:
          data === undefined
            ? undefined
            : binary
              ? Buffer.from(data, "base64")
              : data,
        signal: AbortSignal.timeout(120000),
      },
    );
    const contentType =
      response.headers.get("content-type") || "application/json";
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 21 * 1024 * 1024)
      throw new Error("The response exceeds Scribble's image limit.");
    const result = {
      status: response.status,
      contentType,
      body: Buffer.from(bytes).toString("base64"),
    };
    if (response.ok && method === "POST" && url.pathname === "/sessions") {
      const next = JSON.parse(Buffer.from(bytes).toString());
      const nextId = new URLSearchParams(
        new URL(next.url, connection.origin).hash.slice(1),
      ).get("session");
      const { root } = await this.lookup(id);
      await this.register(root, nextId);
    }
    return result;
  }
  async feedback(id) {
    const { root } = await this.lookup(id);
    const dir = sessionDir(root, id);
    const bundle = await readJson(join(dir, "feedback.json")).catch(() => null);
    if (!bundle) throw new Error("The user has not finished this canvas yet.");
    const handoff = await prepareHandoff(bundle, dir);
    const brief = await readFile(handoff.briefPath, "utf8");
    const readAt = new Date().toISOString();
    await atomicJson(join(dir, "plugin-read.json"), { readAt });
    return { bundle, brief, readAt };
  }
  async image(id, imageId) {
    const { root, session } = await this.lookup(id);
    const image = session.images.find((image) => image.id === imageId);
    if (!image) throw new Error("Image not found in this canvas.");
    return {
      type: "image",
      mimeType: image.mime,
      data: (
        await readFile(join(sessionDir(root, id), "images", image.file))
      ).toString("base64"),
    };
  }
  async delivery(id, token) {
    const { root } = await this.authorize(id, token);
    return await readJson(join(sessionDir(root, id), "plugin-read.json")).catch(
      () => ({ readAt: null }),
    );
  }
}
