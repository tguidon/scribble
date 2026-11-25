#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { McpServer, StdioServerTransport, z } from "./dist/sdk.mjs";
import { PluginBackend } from "./backend.mjs";
import { FrameRelay } from "./frame-relay.mjs";
import { VERSION } from "../skills/scribble/scripts/lib/version.mjs";
import {
  pollAgentDelivery,
  settleAgentDelivery,
} from "../skills/scribble/scripts/lib/agent-delivery.mjs";

const RESOURCE = "ui://scribble/editor.html";
const CLAUDE_OPEN =
  "Open browserUrl for the user now. In the Claude desktop app, open it in the built-in browser pane (preview_start with this url). In a terminal session, open it in the default browser (for example `open` on macOS). Tell the user to finish feedback and choose Send to this chat, then end your turn. Do not poll.";
export function createPlugin(options = {}) {
  const backend = options.backend || new PluginBackend(options);
  const frames = new FrameRelay(backend);
  const server = new McpServer(
    { name: "scribble", version: VERSION },
    {
      instructions:
        "Open a fresh canvas with open_canvas when the user asks for Scribble. End your turn while they annotate. When they send feedback, call read_feedback with the exact canvas ID in their message, then read each original with read_image. Never select a latest canvas or poll for submissions.",
    },
  );
  const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
  const auth = { sessionId: id, token: z.string().length(64) };
  const claude =
    (options.harness || process.env.SCRIBBLE_HARNESS) === "claude-code";
  const result = (structuredContent) => ({
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  });
  const privateResult = (value) => ({
    content: [],
    _meta: { scribble: value },
  });
  const guarded =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error.message }],
        };
      }
    };
  server.registerResource(
    "scribble-editor",
    RESOURCE,
    { mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: RESOURCE,
          mimeType: "text/html;profile=mcp-app",
          text: await readFile(
            new URL("./dist/editor.html", import.meta.url),
            "utf8",
          ),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    }),
  );
  server.registerTool(
    "open_canvas",
    {
      title: "Scribble",
      description:
        "Create a fresh visual feedback canvas in the user's local project. Open the editor and wait for the user to send feedback; do not poll. Requires local desktop access.",
      inputSchema: {
        projectPath: z.string().min(1),
        title: z.string().max(120).default("A little visual direction"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      // Claude Desktop draws MCP Apps but gives them no server tools, so the
      // embedded editor could only show its fallback. Claude uses the browser.
      ...(!claude && { _meta: { ui: { resourceUri: RESOURCE } } }),
    },
    // The Claude mod binds the chat after this call returns, through
    // bind_delivery. It never rewrites this input: auto mode reviews the call
    // as the model wrote it, and a rewrite leaves that review without a verdict.
    guarded(async ({ projectPath, title }) => {
      const connection = await backend.open(projectPath, title);
      return {
        ...result({
          sessionId: connection.sessionId,
          title,
          browserUrl: connection.url,
          ...(claude && { next: CLAUDE_OPEN }),
        }),
        _meta: { scribble: connection },
      };
    }),
  );
  server.registerTool(
    "read_feedback",
    {
      title: "Read Scribble feedback",
      description:
        "Read the exact finished canvas the user sent. Returns the brief, annotation geometry, capture context, and image IDs. Then inspect originals with read_image before making changes. Records that feedback was read, not that changes were applied.",
      inputSchema: { sessionId: id },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded(async ({ sessionId }) => {
      const { bundle, brief } = await backend.feedback(sessionId);
      return {
        content: [{ type: "text", text: brief }],
        structuredContent: bundle,
      };
    }),
  );
  server.registerTool(
    "read_image",
    {
      title: "Read a Scribble screenshot",
      description:
        "Inspect an original image from the finished feedback session. Use the session and image IDs from read_feedback.",
      inputSchema: { sessionId: id, imageId: id },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ sessionId, imageId }) => ({
      content: [await backend.image(sessionId, imageId)],
    })),
  );
  server.registerTool(
    "editor_request",
    {
      title: "Scribble editor action",
      description:
        "Session-scoped editor transport. Used only by the Scribble UI.",
      inputSchema: {
        ...auth,
        path: z.string().max(4096),
        method: z.enum(["GET", "POST", "PUT"]).default("GET"),
        data: z
          .string()
          .max(28 * 1024 * 1024)
          .optional(),
        binary: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    guarded(async ({ sessionId, token, path, method, data, binary }) =>
      privateResult(
        await backend.request(sessionId, token, path, method, data, binary),
      ),
    ),
  );
  server.registerTool(
    "live_frame",
    {
      title: "Scribble live preview",
      description:
        "Read the latest live frame for this canvas without retaining stale frames. UI only.",
      inputSchema: {
        ...auth,
        kind: z.enum(["web", "simulator"]),
        generation: z.number().int().nonnegative(),
        after: z.number().int().nonnegative().default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    guarded(async ({ sessionId, token, kind, generation, after }, { signal }) =>
      privateResult(
        await frames.next(sessionId, token, kind, generation, after, signal),
      ),
    ),
  );
  server.registerTool(
    "record_delivery",
    {
      title: "Record Scribble delivery",
      description: "Record that the host accepted finished feedback. UI only.",
      inputSchema: auth,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    guarded(async ({ sessionId, token }) =>
      privateResult(await backend.recordDelivery(sessionId, token)),
    ),
  );
  server.registerTool(
    "delivery_status",
    {
      title: "Scribble receipt",
      description: "Check whether the finished canvas has been read. UI only.",
      inputSchema: auth,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    guarded(async ({ sessionId, token }) =>
      privateResult(await backend.delivery(sessionId, token)),
    ),
  );
  // The mod uses the host's existing MCP connection. These control operations
  // are absent in Codex. They must not carry app-only `_meta.ui.visibility`:
  // Claude Code drops such tools from the session, and `$.mcp.call` then cannot
  // reach them. The mod hides them from the model with a `tool.offer` hook.
  if (claude) {
    const owner = { chatId: id, consumer: id };
    server.registerTool(
      "bind_delivery",
      {
        description:
          "Internal to the Scribble Claude Code mod. Never call this tool: it links a new canvas to the chat that opened it.",
        inputSchema: { ...auth, chatId: id },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      guarded(async ({ sessionId, token, chatId }) =>
        result(await backend.bindDelivery(sessionId, token, chatId)),
      ),
    );
    server.registerTool(
      "poll_delivery",
      {
        description:
          "Internal to the Scribble Claude Code mod. Never call this tool: it renews the mod's lease and claims pending feedback.",
        inputSchema: owner,
        outputSchema: {
          item: z
            .object({
              sessionId: id,
              requestId: id,
              text: z.string(),
              marker: z.string(),
            })
            .nullable(),
        },
        annotations: { openWorldHint: false },
      },
      guarded(async ({ chatId, consumer }) =>
        result({
          item: await pollAgentDelivery(backend.directory, chatId, consumer),
        }),
      ),
    );
    server.registerTool(
      "settle_delivery",
      {
        description:
          "Internal to the Scribble Claude Code mod. Never call this tool: it saves the mod's prompt outcome.",
        inputSchema: {
          ...owner,
          item: z.object({ sessionId: id, requestId: id }),
          error: z.boolean(),
        },
        annotations: { openWorldHint: false },
      },
      guarded(async ({ chatId, consumer, item, error }) => {
        await settleAgentDelivery(
          backend.directory,
          chatId,
          consumer,
          item,
          error,
        );
        return result({});
      }),
    );
  }
  return {
    server,
    backend,
    close: async () => {
      frames.close();
      await server.close();
    },
  };
}
if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  const plugin = createPlugin();
  await plugin.server.connect(new StdioServerTransport());
  process.stdin.on("end", () => void plugin.close());
  process.once("SIGTERM", () => void plugin.close());
}
