import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, readJson, safeId, sessionDir } from "./store.mjs";

// The immutable bundle is the submission marker, even after an interrupted save.
export async function pendingFeedback(root) {
  const ids = await readdir(join(root, "sessions")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const pending = [];
  for (const id of ids.filter(safeId)) {
    const dir = sessionDir(root, id);
    const bundlePath = join(dir, "feedback.json");
    const feedback = await readJson(bundlePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!feedback) continue;
    const receipt = await readJson(join(dir, "read.json")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!receipt)
      pending.push({
        sessionId: id,
        title: feedback.title,
        submittedAt: feedback.submittedAt,
        bundlePath,
      });
  }
  return pending.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export async function acknowledgeFeedback(root, id) {
  const dir = sessionDir(root, id);
  await readJson(join(dir, "feedback.json")).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error("Feedback has not been sent yet.");
    throw error;
  });
  await atomicJson(join(dir, "read.json"), {
    sessionId: id,
    readAt: new Date().toISOString(),
  });
  return { sessionId: id, acknowledged: true };
}
