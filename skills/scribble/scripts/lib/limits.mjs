export const MAX_DRAFT_BYTES = 4 * 1024 * 1024;
export const DRAFT_TOO_LARGE =
  "This feedback exceeds the 4 MB limit for marks and text. Shorten a comment or use a separate session for more feedback.";
/** @param {{ message: string, images: unknown[] }} draft */
export function draftBytes(draft) {
  return new TextEncoder().encode(
    JSON.stringify({ message: draft.message, images: draft.images }),
  ).byteLength;
}
