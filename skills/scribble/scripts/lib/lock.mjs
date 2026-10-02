import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export async function withStartLock(root, task) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, "server-start.lock");
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = await readFile(join(lock, "pid"), "utf8")
        .then(Number)
        .catch(() => null);
      const age = await stat(lock)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => 0);
      if ((pid && !alive(pid)) || (!pid && age > 30000))
        await rm(lock, { recursive: true, force: true });
      else await delay(100);
      continue;
    }
    try {
      await writeFile(join(lock, "pid"), String(process.pid));
      return await task();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error(
    "Another Scribble launcher is still starting. Try again in a few seconds.",
  );
}
