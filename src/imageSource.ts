import { getEditorHost } from "./editorHost";

// Codex's embedded editor permits data images, but blocks blob image URLs.
// Keep object URLs in the standalone browser to avoid base64 copies there.
export function createImageSource(bytes: Uint8Array, mime: string): string {
  if (!getEditorHost())
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
}

export function releaseImageSource(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
