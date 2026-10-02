import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";

export const safeId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id);
export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, path);
}
export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export function sessionDir(root, id) {
  if (!safeId(id)) throw new Error("Invalid session ID.");
  return join(resolve(root), "sessions", id);
}
export async function createSession(root, title = "A little visual direction") {
  const id = randomUUID();
  const dir = sessionDir(root, id);
  await mkdir(join(dir, "images"), { recursive: true, mode: 0o700 });
  const session = {
    version: 1,
    id,
    title,
    token: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 0,
    status: "draft",
    message: "",
    images: [],
  };
  await atomicJson(join(dir, "session.json"), session);
  return session;
}
export async function loadSession(root, id) {
  return readJson(join(sessionDir(root, id), "session.json"));
}
export async function latestSession(root, draftOnly = false) {
  const dirs = await readdir(join(root, "sessions")).catch(() => []);
  const sessions = await Promise.all(
    dirs.filter(safeId).map((id) => loadSession(root, id).catch(() => null)),
  );
  return sessions
    .filter((s) => s && (!draftOnly || s.status === "draft"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
export function publicSession(session) {
  const { token, lastSave, ...data } = session;
  return {
    ...data,
    lastSaveId:
      lastSave?.revision === session.revision ? lastSave.id : undefined,
  };
}
