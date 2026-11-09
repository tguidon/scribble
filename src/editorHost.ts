import type { CaptureKind } from "./types";
import type { ImageCache } from "./imageCache";

// The standalone editor has no host. The plugin supplies this adapter before
// mounting React, keeping the canvas independent of any chat product SDK.
export type DeliveryReceipt = {
  acceptedAt: string | null;
  readAt: string | null;
  queuedAt?: string | null;
  connected?: boolean;
  error?: string | null;
};
export type FeedbackDelivery = {
  canSend: boolean;
  sendFeedback(): Promise<void>;
  deliveryStatus(): Promise<DeliveryReceipt>;
};
export type EditorHost = FeedbackDelivery & {
  sessionId: string;
  browserUrl: string;
  request(path: string, options?: RequestInit): Promise<Response>;
  images: ImageCache;
  frames(
    kind: CaptureKind,
    generation: number,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array>;
  newCanvas(url: string): void;
  expand?: () => Promise<void>;
};
let host: EditorHost | undefined;
export const getEditorHost = () => host;
export const setEditorHost = (value: EditorHost) => {
  host = value;
};
