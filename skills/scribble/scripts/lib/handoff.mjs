import { join } from "node:path";
import { writeFeedbackBrief } from "./brief.mjs";

// Keep clipboard content small. The immutable bundle and original images stay on disk.
export async function prepareHandoff(bundle, directory) {
  const { briefPath } = await writeFeedbackBrief(bundle, directory);
  const bundlePath = join(directory, "feedback.json");
  return {
    sessionId: bundle.sessionId,
    briefPath,
    bundlePath,
    text: [
      "Apply my Scribble feedback to this project.",
      "",
      `Session: ${bundle.sessionId}`,
      `Read the feedback brief: ${JSON.stringify(briefPath)}`,
      `Full annotation data: ${JSON.stringify(bundlePath)}`,
      "",
      "Read the brief and inspect every original image at the paths it lists before making changes. The brief contains my comments, mark positions, and capture context. Use the JSON if you need the full drawing data.",
      "Follow my feedback within the scope of this task and verify the changes. If these local files are unavailable, ask me to provide them.",
    ].join("\n"),
  };
}
