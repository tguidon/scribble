---
name: scribble
disable-model-invocation: true
argument-hint: "[start [--new] | status | stop]"
description: Launch the Scribble editor web app and collect annotated screenshots from the user. Use when the user invokes Scribble to give visual feedback.
---

# Scribble

## Launch first

A bare `$scribble` / `/scribble` invocation or `scribble start` means **open the editor and collect feedback now**. The optional word `start` makes this intent explicit. Follow a request to explain or modify Scribble as that task instead.

For a launch request, open the editor immediately using the plugin tools or the bundled launcher below.

**When the Scribble plugin tools are available:** call `open_canvas` with the absolute path of the user's current project instead of running the launcher below. Use its embedded editor when the host renders it, or share the returned `browserUrl` if it does not. Tell the user to finish feedback and choose **Send to this chat** in the plugin, or copy and paste from the browser. End your turn; do not poll. Each call creates a fresh canvas. See [plugin feedback](references/plugin.md) when the user sends a canvas ID or needs help with plugin delivery. The CLI commands below remain available for explicit `status` and `stop` requests.

**Without plugin tools**, resolve `SKILL_DIRECTORY` from the absolute path of this SKILL.md and run this command from the user's project directory:

```sh
node "SKILL_DIRECTORY/scripts/scribble.mjs" start --detach --no-open
```

The app is bundled and requires Node.js 22+. The launcher already checks the server, starts or reuses it, and selects a session. Run it directly; source inspection, project exploration, builds, dependency installation, and separate server checks are unnecessary before launch. If an error requires investigation, read [server lifecycle and recovery](references/server-lifecycle.md).

### Optional commands

Use the word after the skill name to select the action. In Claude Code it arrives as skill arguments; in Codex it is part of the user's message. Use only the corresponding command below, not arbitrary argument text as shell code.

| Invocation suffix | Action |
| --- | --- |
| No suffix, or `start` | Run the launch command above. Resume a draft or open a new canvas. |
| `start --new` | Add `--new` to the launch command. Open a fresh draft and preserve prior feedback. |
| `status` | Run `node "SKILL_DIRECTORY/scripts/scribble.mjs" status`, summarize the result, and stop. |
| `stop` | Wait for **Draft saved** if the user is editing, then run `node "SKILL_DIRECTORY/scripts/scribble.mjs" stop`. Report the result and stop. |

Keep the working directory fixed. Use the same `--dir PATH` on every command if custom storage was requested; concurrent agents need separate storage directories. Leave the server running after feedback unless asked to stop it. Before a known version upgrade, wait for **Draft saved** in active tabs and reload them afterward.

## Open and hand back to the user

1. Open the exact returned `url` in the available browser and share the link immediately. Preserve its token fragment.
2. Tell the user: **Add screenshots, marks, and comments. Choose Finish feedback, then Copy for agent, and paste the handoff into this chat.** They can also choose **Capture live app**; read [live capture](references/live-capture.md) only when helping with webpage, shared-tab, or simulator capture.
3. End your turn after sharing the URL and instructions. The user controls delivery by pasting the handoff. Do not poll, wait for a submission, or automatically read saved feedback. The editor's **New canvas** button starts another round without invoking the skill again.
4. When the user pastes a handoff, read [the feedback workflow](references/feedback.md) and use the exact files it names. A new launch only opens the editor; it does not authorize applying earlier feedback.
