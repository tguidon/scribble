# Scribble

**Show your agent what you mean.**

Scribble opens a local browser canvas for screenshot feedback. Add images, mark what needs changing, write comments, and send one batch back to Codex or Claude Code. No account, hosted backend, or model API key.

## Install with npx skills

Requires **Node.js 22 or newer**. The skill includes its built browser app and server; users do not need to install dependencies or build anything.

From the project where you want to use Scribble:

```sh
npx skills add /path/to/scribble --skill scribble --agent codex claude-code
```

When this repository is published, replace `/path/to/scribble` with its GitHub `owner/repo` or Git URL. This checkout currently has no remote configured. Add `--global` to install across projects, or `--copy` if you prefer copies to symlinks. These options follow the [skills CLI](https://github.com/vercel-labs/skills).

Invoke **`$scribble` in Codex** or **`/scribble` in Claude Code**. The skill is configured for explicit invocation using [Codex skill policy](https://learn.chatgpt.com/docs/build-skills) and [Claude Code invocation settings](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

## The feedback flow

1. The agent starts the skill's launcher from your working project.
2. The launcher checks the local server with an authenticated request. It reuses a healthy server or starts a detached one if needed.
3. An unfinished draft resumes. After a submission, the next invocation opens a fresh session on the same server.
4. Upload, paste, or drag in PNG, JPEG, or WebP screenshots. Add pins, arrows, rectangles, or freehand marks. Every mark has its own comment.
5. Add any overall direction and choose **Send to agent**. The waiting agent receives the saved bundle and image paths.

Drafts save automatically to `.scribble/` in the working project. A browser backup covers unsaved annotation and message edits. Images are stored on disk before becoming editable. Restarting the agent or server does not discard saved work. Multiple tabs use revision checks to prevent silently overwriting each other.

The server remains available for later invocations. It binds only to `127.0.0.1` and requires a session token for screenshots and feedback. Each project has its own storage directory and server. Concurrent launchers share a startup lock. Use a separate `--dir` when separate agents need independent workspaces.

## Local development

```sh
npm install
npm run dev
```

Open the URL printed in the terminal, including its token fragment. The development command does not open a browser automatically.

```sh
npm run build       # Type-check and build the distributable skill app
npm start           # Run the built app and open the browser
npm test            # Server, persistence, isolation, and launcher tests
npm run test:e2e    # Browser acceptance tests using installed Google Chrome
```

The production server uses only Node built-ins. `skills/scribble/` is the complete installable unit. Vite writes the browser build to `skills/scribble/app/`; **commit this directory after UI changes**, because `npx skills` copies files without running a build step.

## Launcher commands

Run these through `node /absolute/path/to/skills/scribble/scripts/scribble.mjs` in an installed skill, or `node bin/scribble.mjs` in this checkout.

| Command | Behavior |
| --- | --- |
| `start --detach --no-open` | Check, start/reuse the server, and return a session URL as JSON |
| `start --new` | Start a separate draft on the existing server |
| `start --session ID` | Reopen a particular draft or submission |
| `wait --session ID --timeout 60` | Wait for submission; exit 2 if still waiting |
| `feedback --session ID` | Read an existing submission |
| `status` | Show the latest session and recorded server process |

Common options: `--dir PATH`, `--port NUMBER`, and `--title TEXT`. Port 0 (the default) selects an available port. Stop the printed server PID with your process manager when you no longer need it. Logs are in `.scribble/server.log` for detached launches. Feedback remains on disk after stopping.

## Feedback format

Each session stores `session.json`, original images under `images/`, and an immutable `feedback.json` after submission. The CLI returns the bundle path and JSON. It includes:

- Session ID, title, submission time, and overall message.
- Original screenshot paths, names, dimensions, and MIME types.
- Mark type, color, points, comment, and screenshot-local number.

Coordinates use **original image pixels from the top-left**, independent of zoom and pan. Pins have one point; arrows and rectangles have endpoints; freehand marks have ordered points. The original images and structured geometry let the agent inspect the exact areas without relying on a flattened preview. The browser download contains JSON; image paths refer to files on the same computer.

## Limits and recovery

- 30 images per session; 20 MB and 40 megapixels per image.
- 500 annotations per image; 5,000 points per drawing.
- 10,000 characters per comment; 20,000 for the overall message.
- Screenshot deletion removes it from the draft; undo/redo covers marks and text, not screenshot uploads/removal. Original files remain on disk until the user removes the session directory.
- If saving fails, the page shows **Not saved to server** and offers **Retry save**. Keep the tab open until saved. Reopening the same session restores compatible browser drafts.
- If another tab saved a newer revision, reload to use that server draft; unsaved edits from an older revision are not merged automatically.
- Node must be allowed to bind a local port and launch a background process. Agent sandboxes may request permission for that operation.

The example screenshot is an authored, labeled fictional workspace generated locally. It contains no external imagery or customer data.
