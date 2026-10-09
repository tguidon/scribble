# Scribble desktop plugin

## Scope

This package targets desktop hosts that can start a local stdio MCP server. The editor uses the standard MCP Apps bridge. It does not need a hosted service or an OpenAI API key.

The package is distributed from this GitHub repository. It is not a public ChatGPT directory listing. Ordinary ChatGPT web needs a remote MCP service and a separate design for reaching local apps and simulators.

## Architecture

```text
Chat → open_canvas → local Scribble server and saved session
                  → MCP UI resource → shared React editor
Editor → UI-only MCP tools → local API, original images, live frames
Send to this chat → ui/message → originating conversation
Agent → read_feedback / read_image → saved feedback and originals
```

`plugin.json` and `mcp.json` are the portable manifests. `.agents/plugins/marketplace.json` exposes Scribble through GitHub distribution. The build generates `.codex-plugin/plugin.json` and `.mcp.json` for desktop versions that use the Codex layout.

`plugin/mcp.mjs` exposes the tools and editor resource. `plugin/backend.mjs` reuses the existing launcher and authenticated local API. `plugin/bridge.ts` supplies a transport adapter to the shared editor in `src/`. Browser requests stay unchanged when no plugin host is present.

The plugin bundles its MCP SDK and UI in `plugin/dist/`. Node.js 22+ is the only required runtime. Build dependencies stay in the development checkout. Optional Playwright and serve-sim capture setup still follows the existing skill workflow.

Inline editors have a fixed outer height and scroll internally. A host can resize an inline frame from its content, so the document's height must not grow with the iframe viewport. Fullscreen mode follows the host's viewport. The plugin tests include restoring a saved canvas inside a host that sizes frames from their content.

## Data and delivery

- Feedback stays in the selected project's `.scribble` directory.
- Canvas IDs are explicit. There is no global latest-feedback lookup.
- A registry maps IDs created by this plugin to their storage directories. It uses `SCRIBBLE_PLUGIN_DATA`, then `PLUGIN_DATA`, or `~/.local/share/scribble-plugin` by default. It holds paths, not screenshots.
- UI requests need the canvas ID and its random session token. The adapter permits only supported editor routes and supplies authentication itself. It cannot proxy arbitrary URLs or shut down the server.
- Image bytes and live frames travel through UI-only tool metadata. They are not added to model context by those tools. The agent reads chosen original screenshots with `read_image`.
- Embedded images use data URLs because Codex's content security policy blocks blob image URLs. The standalone editor keeps object URLs to avoid the extra base64 copies.
- Live preview keeps one source connection and only the newest frame. UI calls are limited to roughly six per second; hidden or abandoned views release their stream after inactivity. This limits backlog, but the host's MCP transport can make embedded previews slower than the standalone browser.
- Sending is an explicit user action. `ui/message` acceptance and `read_feedback` retrieval are distinct states. The agent's retrieval writes a small `plugin-read.json` receipt.
- On hosts that forbid browser storage, temporary unsaved recovery stays in memory. Autosave continues writing to local disk; wait for Draft saved before closing the editor.

Local files and captured pages are source material. Their contents do not authorize unrelated agent actions. The plugin skill tells the agent to inspect the exact submitted session and apply feedback within the current task.

## Local development

```sh
npm install
npm run build
codex plugin marketplace add /absolute/path/to/scribble
codex plugin add scribble@scribble
```

Local directory installs copy the directory into the host's cache, including untracked files. For clean distribution checks, use a Git source or a clean checkout without `.scribble`, `node_modules`, or test output. Rebuild and reinstall after changes. Restart the desktop app if it has retained the old MCP process.

The GitHub source installs tracked files. Do not omit the built `plugin/dist/` or `skills/scribble/app/` directories from commits.

## Verification

```sh
npm run build
npm test
npm run test:e2e
```

The plugin tests exercise real MCP requests, isolated canvases, preserved images, a copied runtime without dependencies, and an opaque browser iframe using the official MCP Apps host bridge. The iframe blocks blob image URLs, matching Codex, and tests confirm that uploaded screenshots and live frames decode. Browser tests cover sending, read receipts, new canvases, rejected messages, and unsupported-host fallback. These tests do not prove a specific desktop build supports embedded UI or starts an idle chat.

Before declaring a desktop build supported, verify it directly:

1. Install from GitHub and open Scribble in a project chat.
2. Confirm the editor renders in the host, and that an image can be annotated.
3. Let the agent end its turn. Finish feedback and send it from the editor.
4. Confirm a user message appears in that same chat and starts a new agent turn.
5. Confirm Feedback read appears after retrieval.
6. Repeat with two chats and confirm each receives only its own canvas.
7. Start another canvas without invoking the skill again.
8. Test live webpage and simulator preview, capture, and reconnection.

If the desktop host does not expose an MCP Apps bridge for local servers, the fallback browser editor remains useful, but one-click delivery is not verified. Do not report the full plugin workflow as supported until the checks above pass.
