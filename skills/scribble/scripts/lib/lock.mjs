import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
async function acquire(root, name, wait) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, name);
  const owner = `${process.pid}:${randomUUID()}`;
  for (let attempt = 0; attempt < (wait ? 150 : 3); attempt++) {
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const recorded = await readFile(join(lock, "owner"), "utf8").catch(
        () => null,
      );
      // Also recognize locks left by older launchers.
      const pid = Number(
        recorded?.split(":")[0] ||
          (await readFile(join(lock, "pid"), "utf8").catch(() => 0)),
      );
      const before = await stat(lock).catch(() => null);
      const age = before ? Date.now() - before.mtimeMs : 0;
      if ((pid && !alive(pid)) || (!pid && age > 30000)) {
        // Only one contender may reap a stale directory. Recheck after acquiring it.
        const reaping = join(lock, "reaping");
        try {
          await mkdir(reaping);
        } catch {
          await delay(100);
          continue;
        }
        try {
          const now = await readFile(join(lock, "owner"), "utf8").catch(
            () => null,
          );
          if (
            now === recorded &&
            (await stat(lock).catch(() => null))?.ino === before?.ino
          )
            await rm(lock, { recursive: true, force: true });
        } finally {
          if ((await stat(lock).catch(() => null))?.ino === before?.ino)
            await rm(reaping, { recursive: true, force: true });
        }
        continue;
      }
      if (!wait)
        throw new Error(
          "A Scribble server already owns this storage directory. Reuse it or stop that process first.",
        );
      await delay(100);
      continue;
    }
    try {
      await writeFile(join(lock, "owner"), owner);
    } catch (error) {
      await rm(lock, { recursive: true, force: true });
      throw error;
    }
    return async () => {
      if (
        (await readFile(join(lock, "owner"), "utf8").catch(() => null)) ===
        owner
      )
        await rm(lock, { recursive: true, force: true });
    };
  }
  throw new Error(
    "Another Scribble process is starting. Try again in a few seconds.",
  );
}
export async function withStartLock(root, task) {
  const release = await acquire(root, "server-start.lock", true);
  try {
    return await task();
  } finally {
    await release();
  }
}
export const acquireServerLease = (root) =>
  acquire(root, "server-owner.lock", false);
