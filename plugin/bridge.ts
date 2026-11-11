import { App } from "@modelcontextprotocol/ext-apps";
import type { EditorHost } from "../src/editorHost";
import { version } from "../skills/scribble/version.json";
import { createImageCache } from "../src/imageCache";
import { createImageSource, releaseImageSource } from "../src/imageSource";
import { feedbackMessage } from "../skills/scribble/scripts/lib/feedback-message.mjs";

export type Connection = { sessionId: string; token: string; url: string };
export const app = new App(
  { name: "Scribble", version },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: false },
);
const decode = (base64: string) =>
  Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
async function encode(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(blob);
  });
}
export function createEditorHost(
  connection: Connection,
  change: (connection: Connection) => void,
): EditorHost & { dispose(): void } {
  const images = createImageCache(async (id, signal) => {
    const response = await request(`/images/${id}`, { signal });
    if (!response.ok) throw new Error("Could not load this screenshot.");
    const blob = await response.blob();
    return createImageSource(
      new Uint8Array(await blob.arrayBuffer()),
      blob.type,
    );
  }, releaseImageSource);
  const auth = { sessionId: connection.sessionId, token: connection.token };
  type Receipt = { acceptedAt: string | null; readAt: string | null };
  let acceptedAt: string | null = null;
  let sending: Promise<void> | undefined;
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal | null,
  ): Promise<T> {
    const response = await app.callServerTool(
      { name, arguments: { ...auth, ...args } },
      { signal: signal || undefined, timeout: 125000 },
    );
    if (response.isError)
      throw new Error(
        response.content
          ?.map((item) => (item.type === "text" ? item.text : ""))
          .join("\n") || "The plugin could not complete that action.",
      );
    const result = response._meta?.scribble;
    if (!result)
      throw new Error(
        "The host did not return Scribble's editor data. Open the browser editor instead.",
      );
    return result as T;
  }
  async function request(path: string, options: RequestInit = {}) {
    const binary = options.body instanceof Blob;
    if (options.body && !binary && typeof options.body !== "string")
      throw new Error("Unsupported editor request body.");
    const data = binary ? await encode(options.body as Blob) : options.body;
    const result = await call<{
      status: number;
      contentType: string;
      body: string;
    }>(
      "editor_request",
      {
        path,
        method: options.method || "GET",
        data: data || undefined,
        binary,
      },
      options.signal,
    );
    return new Response(decode(result.body), {
      status: result.status,
      headers: { "Content-Type": result.contentType },
    });
  }
  return {
    sessionId: connection.sessionId,
    browserUrl: connection.url,
    canSend: !!app.getHostCapabilities()?.message?.text,
    request,
    images,
    async *frames(kind, generation, signal) {
      let after = 0;
      while (true) {
        signal.throwIfAborted();
        const result = await call<{ sequence: number; frame: string | null }>(
          "live_frame",
          { kind, generation, after },
          signal,
        );
        after = result.sequence;
        if (result.frame) yield decode(result.frame);
        // Bound IPC traffic even when the source produces 60 frames/sec.
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    },
    newCanvas(url) {
      const next = new URL(url, connection.url);
      const params = new URLSearchParams(next.hash.slice(1));
      if (!params.get("session") || !params.get("token"))
        throw new Error("The new canvas connection is incomplete.");
      change({
        sessionId: params.get("session")!,
        token: params.get("token")!,
        url: next.href,
      });
    },
    async sendFeedback() {
      if (sending) return sending;
      if (acceptedAt) return;
      const operation = (async () => {
        const previous = await call<Receipt>("delivery_status", {});
        if (previous.acceptedAt || previous.readAt) {
          acceptedAt = previous.acceptedAt || previous.readAt;
          return;
        }
        const result = await app.sendMessage(
          {
            role: "user",
            content: [
              {
                type: "text",
                text: feedbackMessage(connection.sessionId),
              },
            ],
          },
          { timeout: 15000 },
        );
        if (result.isError)
          throw new Error(
            "This host declined the message. Copy the handoff and paste it into this chat.",
          );
        // Acceptance is certain even if persisting its receipt fails. Keep the
        // button disabled and retry recording it during delivery polling.
        acceptedAt = new Date().toISOString();
        await call("record_delivery", {}).catch(() => {});
      })();
      sending = operation;
      try {
        await operation;
      } finally {
        sending = undefined;
      }
    },
    async deliveryStatus() {
      // A remounted receipt must not offer Send while the original send is
      // still waiting for the host's acknowledgement.
      await sending?.catch(() => {});
      const receipt = await call<Receipt>("delivery_status", {});
      acceptedAt ||= receipt.acceptedAt || receipt.readAt;
      if (acceptedAt && !receipt.acceptedAt && !receipt.readAt)
        await call("record_delivery", {}).catch(() => {});
      return { ...receipt, acceptedAt: receipt.acceptedAt || acceptedAt };
    },
    ...(app.getHostContext()?.availableDisplayModes?.includes("fullscreen")
      ? {
          expand: async () => {
            await app.requestDisplayMode({ mode: "fullscreen" });
          },
        }
      : {}),
    dispose() {
      images.dispose();
    },
  };
}
