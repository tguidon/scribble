// The standalone editor has no host. The plugin supplies this adapter before
// mounting React, keeping the canvas independent of any chat product SDK.
export type EditorHost = {
  sessionId: string;
  browserUrl: string;
  canSend: boolean;
  request(path: string, options?: RequestInit): Promise<Response>;
  imageUrl(id: string): string;
  hydrate(images: { id: string }[]): Promise<void>;
  newCanvas(url: string): void;
  sendFeedback(): Promise<void>;
  deliveryStatus(): Promise<{ readAt: string | null }>;
  expand?: () => Promise<void>;
};
let host: EditorHost | undefined;
export const getEditorHost = () => host;
export const setEditorHost = (value: EditorHost) => {
  host = value;
};
