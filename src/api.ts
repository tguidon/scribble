import type { Draft, Session } from "./types";
import { version } from "../skills/scribble/version.json";
import { getEditorHost } from "./editorHost";
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("token") || "";
export const currentSessionId = () =>
  getEditorHost()?.sessionId || params.get("session") || "";
export async function apiResponse(path: string, options: RequestInit = {}) {
  const host = getEditorHost();
  if (host) return host.request(path, options);
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Scribble-Session": currentSessionId(),
      "X-Scribble-Version": version,
      ...options.headers,
    },
  });
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiResponse(path, options);
  const serverVersion = response.headers.get("X-Scribble-Version");
  if (serverVersion && serverVersion !== version)
    throw new Error(
      "The Scribble app and server versions differ. Run the Scribble skill again, then reload this tab. Saved feedback is preserved.",
    );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.error || "The local server could not complete that request.",
      ),
      { status: response.status },
    );
  if (Array.isArray(data?.images)) await getEditorHost()?.hydrate(data.images);
  return data;
}
export const imageUrl = (id: string) =>
  getEditorHost()?.imageUrl(id) ||
  `/api/images/${id}?token=${encodeURIComponent(token)}&session=${encodeURIComponent(currentSessionId())}`;
export const loadSession = () => request<Session>("/session");
export const saveDraft = (draft: Draft, revision: number, saveId: string) =>
  request<Session>("/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...draft, revision, saveId }),
  });
export async function uploadImage(file: File): Promise<Session> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error(`${file.name}: choose a PNG, JPEG, or WebP image.`);
  if (file.size > 20 * 1024 * 1024)
    throw new Error(`${file.name}: maximum image size is 20 MB.`);
  const image = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name}: this image could not be opened.`);
  });
  const { width, height } = image;
  image.close();
  if (width * height > 40000000)
    throw new Error(`${file.name}: maximum image size is 40 megapixels.`);
  const query = new URLSearchParams({
    width: String(width),
    height: String(height),
    name: file.name,
  });
  return request<Session>(`/images?${query}`, { method: "POST", body: file });
}

export async function checkCaptureRuntime() {
  let health: { version?: string };
  try {
    health = await request<{ version?: string }>("/health");
  } catch (error) {
    if ((error as { status?: number }).status === 404)
      throw new Error(
        "This Scribble server is too old for live capture. Ask your agent to restart Scribble, then reload this tab. Your saved draft is preserved.",
      );
    throw error;
  }
  if (health.version !== version)
    throw new Error(
      "The Scribble app and server versions differ. Run the Scribble skill again, then reload this tab. Saved feedback is preserved.",
    );
}
