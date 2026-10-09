import { App } from "@modelcontextprotocol/ext-apps";
import type { EditorHost } from "../src/editorHost";
import { version } from "../skills/scribble/version.json";

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
  const images = new Map<string, string>();
  const auth = { sessionId: connection.sessionId, token: connection.token };
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
    if (path.startsWith("/capture/stream?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      const abort = new AbortController();
      const cancel = () => abort.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      let after = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              if (abort.signal.aborted) throw abort.signal.reason;
              const result = await call<{
                sequence: number;
                frame: string | null;
              }>(
                "live_frame",
                {
                  kind: params.get("kind"),
                  generation: Number(params.get("generation")),
                  after,
                },
                abort.signal,
              );
              if (result.frame) {
                const bytes = decode(result.frame);
                controller.enqueue(
                  new TextEncoder().encode(
                    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`,
                  ),
                );
                controller.enqueue(bytes);
                controller.enqueue(new TextEncoder().encode("\r\n"));
              }
              after = result.sequence;
              // Bound IPC traffic even when the source produces 60 frames/sec.
              await new Promise((resolve) => setTimeout(resolve, 150));
            } catch (error) {
              options.signal?.removeEventListener("abort", cancel);
              controller.error(error);
            }
          },
          cancel() {
            options.signal?.removeEventListener("abort", cancel);
            abort.abort();
          },
        }),
      );
    }
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
    imageUrl: (id) => images.get(id) || "",
    async hydrate(items) {
      for (const image of items) {
        if (images.has(image.id)) continue;
        const response = await request(`/images/${image.id}`);
        if (!response.ok)
          throw new Error("Could not load a screenshot. Reopen this canvas.");
        images.set(image.id, URL.createObjectURL(await response.blob()));
      }
      const keep = new Set(items.map((image) => image.id));
      for (const [id, url] of images)
        if (!keep.has(id)) {
          URL.revokeObjectURL(url);
          images.delete(id);
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
      const result = await app.sendMessage(
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Apply my Scribble feedback from canvas ${connection.sessionId}. Use Scribble's read_feedback tool with sessionId "${connection.sessionId}", then inspect every original image with read_image before making changes. Follow my feedback within this task's scope and verify the result.`,
            },
          ],
        },
        { timeout: 15000 },
      );
      if (result.isError)
        throw new Error(
          "This host declined the message. Copy the handoff and paste it into this chat.",
        );
    },
    deliveryStatus: () => call("delivery_status", {}),
    ...(app.getHostContext()?.availableDisplayModes?.includes("fullscreen")
      ? {
          expand: async () => {
            await app.requestDisplayMode({ mode: "fullscreen" });
          },
        }
      : {}),
    dispose() {
      for (const url of images.values()) URL.revokeObjectURL(url);
      images.clear();
    },
  };
}
