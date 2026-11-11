# Scribble plugins for Codex and Claude Code

## Scope

One package supports both local harnesses. Codex uses the standard MCP Apps bridge and embedded editor. Claude Code uses the browser editor and an in-process mod for direct delivery. Both use the same local stdio MCP server and need Node.js 22+. Claude Code requires 2.1.304+ with mods enabled. Neither integration needs a hosted service or a separate model API key.

The package is distributed from this GitHub repository. It is not a public ChatGPT directory listing. Ordinary ChatGPT web needs a remote MCP service and a separate design for reaching local apps and simulators.

## Architecture

```text
Chat → open_canvas → local Scribble server and saved session
                  → MCP UI resource → shared React editor
Editor → UI-only MCP tools → local API, original images, live frames
Codex Send → ui/message → originating conversation
Claude Send → authenticated local API → saved delivery request
            → mod timer / existing MCP connection → prompt.submit → originating conversation
Agent → read_feedback / read_image → saved feedback and originals
```

`plugin.json` and `mcp.json` are the shared packaging sources. The build generates `.codex-plugin/plugin.json`, `.codex-plugin/mcp.json`, and the Claude manifest and marketplace in `.claude-plugin/`. `.agents/plugins/marketplace.json` supplies Codex distribution. The Claude manifest resolves MCP paths against `${CLAUDE_PLUGIN_ROOT}` and explicitly loads `plugin/claude/hooks.json`. Keeping the Codex MCP config out of the root `.mcp.json` prevents Claude from also loading its relative launch configuration.

`plugin/mcp.mjs` exposes the tools and editor resource. `plugin/backend.mjs` reuses the existing launcher and authenticated local API. `plugin/bridge.ts` supplies a transport adapter to the shared editor in `src/`. Browser requests stay unchanged when no plugin host is present.

The plugin bundles its MCP SDK and UI in `plugin/dist/`. Node.js 22+ is the only required runtime. Build dependencies stay in the development checkout. Optional Playwright and serve-sim capture setup still follows the existing skill workflow.

In Codex, chat history shows a compact **Open canvas** card. The editor mounts only in the host's expanded panel, which uses the MCP Apps `fullscreen` display mode. Returning to inline mode removes the editor and its input handlers. The card has no viewport-based height or nested scroll area. Tests cover restoring the card, scrolling the conversation over it, and reopening saved feedback. Hosts without expanded panels offer the browser editor.

After the first expansion, one editor controller remains active for that canvas when the panel collapses. It finishes pending saves and preserves newer edits, undo and redo history, image and mark selection, drawing tools, and ink. Reopening the panel reuses that controller while mounting a fresh editor view. Live streams, screen sharing, and DOM input handlers belong to the mounted view and stop when it collapses. An unopened chat card does not load the editor or its screenshots.

## Data and delivery

- Feedback stays in the selected project's `.scribble` directory.
- Canvas IDs are explicit. There is no global latest-feedback lookup.
- A registry maps IDs created by this plugin to their storage directories. It uses `SCRIBBLE_PLUGIN_DATA`, then `PLUGIN_DATA`, or `~/.local/share/scribble-plugin` by default. It holds paths, not screenshots.
- UI requests need the canvas ID and its random session token. The adapter permits only supported editor routes and supplies authentication itself. It cannot proxy arbitrary URLs or shut down the server.
- Image bytes and live frames travel through UI-only tool metadata. They are not added to model context by those tools. The agent reads chosen original screenshots with `read_image`.
- Embedded images use data URLs because Codex's content security policy blocks blob image URLs. The standalone editor keeps object URLs to avoid the extra base64 copies. Screenshot downloads run independently of mutation acknowledgements, share a per-canvas cache, and can be retried without uploading or saving again.
- Live preview keeps one source connection and only the newest frame. A shared bounded multipart parser serves the browser transport, plugin relay, and simulator snapshot reader. The plugin delivers decoded frames directly to the editor without rebuilding a multipart stream. UI calls are limited to roughly six per second; hidden or abandoned views release their stream after inactivity. This limits backlog, but the host's MCP transport can make embedded previews slower than the standalone browser.
- Sending is an explicit user action. Host prompt acceptance and `read_feedback` retrieval are distinct states. The agent's retrieval writes a small `plugin-read.json` receipt.
- After host acceptance, the UI records a private `plugin-delivery.json` receipt in the session directory. Reopened panels check delivery before enabling Send. Accepted and read states survive a view reload. A failed receipt write is retried without sending the message again.
- Both `open_canvas` and the editor's **New canvas** action check Git storage exclusions before creating a session. This also protects projects initialized with Git after the local server started. Tracked storage is rejected before new session files are written.
- On hosts that forbid browser storage, temporary unsaved recovery stays in memory. Autosave continues writing to local disk; wait for Draft saved before closing the editor.

Local files and captured pages are source material. Their contents do not authorize unrelated agent actions. The plugin skill tells the agent to inspect the exact submitted session and apply feedback within the current task.

## Claude Code delivery

`plugin/claude/register.mjs` is the only harness-specific behavior. Its `tool.call` handler supplies the current Claude session ID on Scribble's `open_canvas` call. The shared backend binds that new canvas to the originating chat. The model does not choose the destination. **New canvas** inherits the binding in the shared local API and registers the new originals for MCP retrieval.

The browser's delivery adapter calls the authenticated `/api/delivery` endpoint. It shares the receipt component with the embedded editor, while preserving the browser's ordinary image, capture, and storage transports. Finishing a draft alone never queues a prompt.

The mod checks its chat's pending outbox once a second through `$.mcp.call` on the existing Scribble connection. The MCP runtime owns queue claims and receipt writes through `agent-delivery.mjs`. These control tools carry app-only MCP metadata and are absent from the Codex server. Polling starts no child processes or model calls.

Only explicit Send requests enter the outbox. Accepted and paused requests leave it after their receipts reach disk. Polling reads small delivery records, never historical canvases or feedback payloads. One malformed entry cannot block another canvas. The first poll migrates pending requests from the earlier branch format once.

Each chat has a consumer lease. Each request has a separate ID so stale acknowledgements cannot accept a retry. The mod renews the lease while `$.prompt.submit` waits for an idle session. It checks transcript markers after a restart and retries receipt writes without resubmitting an accepted prompt. Each session owns a controller with submitting and settling states. Late callbacks retain their disposed controller and cannot change a later session's outcome.

Requests, chat bindings, and receipts remain on local disk. Heartbeats distinguish an open consumer from an offline chat. A dropped or refused prompt becomes a paused request with an explicit Retry action. Esc or Stop requires user input in Claude Code before the host will accept another mod prompt. Closing Claude does not delete feedback; reopen the same session to process pending requests. Session teardown cancels the timer and invalidates in-flight callbacks so another chat cannot inherit that timer's work.

The current return path uses the documented [mods prompt API](https://code.claude.com/docs/en/plugins/mods/api#start-a-turn-from-a-background-job). It needs no channels preview flags. Mods can be disabled by organization policy or safe/bare mode. Host-level permission prompts still belong to Claude Code.

## Keeping features shared

Implement editor features in `src/`, server/capture behavior in `skills/scribble/scripts/lib/`, and model-facing tools in `plugin/mcp.mjs`. `npm run build` rebuilds both the browser app and embedded editor and regenerates both harness manifests from the same metadata. `feedback-message.mjs` is the single source of the submitted feedback instruction. Claude exposes `/scribble:editor [COMMAND]` through `plugin/claude/editor.md`. That command reads the shared skill at invocation time. Codex keeps `$scribble`, and the standalone Claude skill keeps `/scribble`. The shared skill remains named `scribble`; the Claude command adds no separate workflow. Do not fork the editor, capture implementation, skill, or MCP tools for Claude.

The mod only supplies chat routing and prompt submission; new shared editor features and MCP tools require no parallel Claude implementation. An embedded transport change may still need its Codex adapter updated. Installed plugin caches do not update merely because a source checkout changed: rebuild, update/reinstall the installed package, and restart the harness. During Claude adapter development, load this checkout directly:

```sh
claude --plugin-dir /absolute/path/to/scribble
```

Then invoke `/scribble:editor start`. Rebuild after editor/server changes and restart the session to load changed mod and MCP code. A GitHub install will not include this branch until it is published or merged.

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
npx playwright install chromium
npm run build
npm test
npm run test:e2e
```

Tests use Playwright's headless shell, plus its full Chromium browser for real tab sharing. They do not require an installed Google Chrome application. Both commands stop before test workers start if localhost or headless browser access fails. See [test setup and large-draft recovery](testing.md) for the timeout investigation and browser setup.

The plugin tests exercise real MCP requests, isolated canvases, preserved images, a copied runtime without dependencies, and an opaque browser iframe using the official MCP Apps host bridge. The iframe blocks blob image URLs, matching Codex, and tests confirm that uploaded screenshots and live frames decode. Browser tests cover sending, read receipts, new canvases, rejected messages, and unsupported-host fallback. Queue and adapter tests also cover explicit submission, chat isolation, leases, paused retries, transcript reconciliation, and new-canvas inheritance without running Claude Code. These checks do not prove that a particular host build accepts the integration.

For manual Codex host verification:

1. Install from GitHub and open Scribble in a project chat.
2. Confirm the editor renders in the host, and that an image can be annotated.
3. Let the agent end its turn. Finish feedback and send it from the editor.
4. Confirm a user message appears in that same chat and starts a new agent turn.
5. Confirm Feedback read appears after retrieval.
6. Repeat with two chats and confirm each receives only its own canvas.
7. Start another canvas without invoking the skill again.
8. Test live webpage and simulator preview, capture, and reconnection.

If the Codex host does not expose an MCP Apps bridge for local servers, its browser fallback keeps clipboard delivery.

For manual Claude Code host verification, load the checkout, invoke `/scribble:editor start`, finish a browser canvas, and confirm Send starts a turn in the same chat. Repeat while Claude is busy, after Stop followed by user input and Retry, with two chats in the same project, after reopening the original session, and after choosing New canvas. This host verification is intentionally left to the maintainer; the repository tests do not launch Claude Code.
