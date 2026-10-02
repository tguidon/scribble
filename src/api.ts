import type { Draft, Session } from "./types";
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("token") || "";
export const sessionId = params.get("session") || "";
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Scribble-Session": sessionId,
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.error || "The local server could not complete that request.",
      ),
      { status: response.status },
    );
  return data;
}
export const imageUrl = (id: string) =>
  `/api/images/${id}?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}`;
export const feedbackUrl = `/api/feedback?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}`;
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
