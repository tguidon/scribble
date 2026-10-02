# Scribble

**Show your agent what you mean.**

Scribble is a local browser canvas for visual feedback to Codex and Claude Code. Screenshots, marks, and comments show your agent what to change.

No account, hosted backend, or model API key is required.

## Install

Scribble requires **Node.js 22 or newer**. The skill includes the browser app and server. No separate build or dependency installation is required.

From your project directory, run:

```sh
npx skills add tguidon/scribble
```

The installer offers a choice of agents and installation scope. The repository contains one skill, so `--skill scribble` is optional.

To select Codex and Claude Code directly, run:

```sh
npx skills add tguidon/scribble --agent codex claude-code
```

Add `--global` to install across projects. The [skills CLI documentation](https://github.com/vercel-labs/skills) lists all installation flags.

## Use Scribble

1. Run **`$scribble` in Codex** or **`/scribble` in Claude Code**.
2. Open the session link from your agent.
3. Upload, paste, or drag screenshots onto the canvas.
4. Add pins, arrows, rectangles, or freehand marks.
5. Add a comment to each mark that needs an explanation.
6. To describe the overall goal, add a message for the session.
7. Select **Send to agent**.

The agent receives your screenshots, mark positions, and comments in one feedback bundle. The canvas also supports undo, redo, zoom, and pan.

## Sessions and saved drafts

The agent runs the skill only after an explicit request. The launcher sends an authenticated request to the local server. If the server responds, the launcher reuses it. Otherwise, it starts a server in the background.

The latest unfinished draft resumes automatically. After submission, the next skill request opens a new session on the same server. The server remains available for later sessions.

Scribble saves drafts and screenshots in `.scribble/` in your project. A browser backup stores unsaved edits to marks and messages. Saved work remains available after the agent or server stops.

Each project has a separate server and storage directory. A startup lock prevents duplicate servers from simultaneous requests. The server accepts connections only at `127.0.0.1`. Screenshots and feedback require a session token.

### Recover a draft

- If a save fails, select **Retry save**. Keep the tab open until **Draft saved** appears.
- To resume a saved draft, run the skill again.
- If another tab saves a newer draft, reload the page. Scribble does not merge conflicting edits from multiple tabs.

Undo and redo apply to marks and text. They do not apply to screenshot uploads or removal. Screenshot removal excludes the image from the draft but preserves the original file on disk.

## Limits

| Item | Limit |
| --- | --- |
| Screenshots | 30 per session |
| Image formats | PNG, JPEG, WebP |
| Image size | 20 MB and 40 megapixels per image |
| Marks | 500 per image |
| Freehand points | 5,000 per drawing |
| Comment length | 10,000 characters |
| Overall message | 20,000 characters |

## Development

From this repository, run:

```sh
npm install
npm run dev
```

Open the full session URL from the terminal. Keep the token after `#` in the URL.

| Command | Purpose |
| --- | --- |
| `npm run build` | Run TypeScript checks and build the browser app |
| `npm start` | Run the built app and open the browser |
| `npm test` | Run server, storage, and launcher tests |
| `npm run test:e2e` | Run browser tests with an installed Google Chrome |

The complete skill is in `skills/scribble/`. The production server uses only Node built-ins. Vite writes the browser build to `skills/scribble/app/`. The skills installer copies these files without a build step.

After UI changes, run `npm run build`. Then commit the updated `skills/scribble/app/` directory with the source changes.

## Command reference

In this repository, use `node bin/scribble.mjs` as the command prefix.

For an installed skill, use `node /absolute/path/to/skills/scribble/scripts/scribble.mjs` as the command prefix.

| Command | Behavior |
| --- | --- |
| `start --detach --no-open` | Start or reuse the server and return the session URL as JSON |
| `start --new` | Create a separate draft on the existing server |
| `start --session ID` | Open a saved draft or submission |
| `wait --session ID --timeout 60` | Wait for submission, with exit code 2 on timeout |
| `feedback --session ID` | Read a saved submission |
| `status` | Show the latest session and recorded server process |

Common flags are `--dir PATH`, `--port NUMBER`, and `--title TEXT`. The default port is 0, which selects an available port. Background server logs are in `.scribble/server.log`.

If separate agents need independent sessions, use a separate `--dir` for each agent.

To stop the server, use your process manager with the server PID from the launcher. Saved feedback remains on disk.

Agent sandboxes can require permission to open a local port or start a background process.

## Feedback format

Each session contains `session.json` and original screenshots in `images/`. Submission creates a `feedback.json` file that remains unchanged. The CLI returns this file path and its JSON contents.

The feedback bundle contains:

- The session ID, title, submission time, and overall message.
- Each screenshot's path, name, dimensions, and MIME type.
- Each mark's type, color, points, comment, and number within its screenshot.

Coordinates use **original image pixels from the top-left corner**. Zoom and pan do not change these coordinates. Pins have one point. Arrows and rectangles have endpoints. Freehand marks have ordered points.

The browser download contains JSON. Its image paths refer to files on the same computer.

The example screenshot shows a fictional workspace. Scribble creates it locally without external images or customer data.
