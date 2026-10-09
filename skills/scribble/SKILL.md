---
name: scribble
disable-model-invocation: true
argument-hint: "[start [--new] | status | stop]"
description: Launch the Scribble editor web app and collect annotated screenshots from the user. Use when the user invokes Scribble to give visual feedback.
---

# Scribble

## Launch first

A bare `$scribble` / `/scribble` invocation or `scribble start` means **open the editor and collect feedback now**. The optional word `start` makes this intent explicit. Follow a request to explain or modify Scribble as that task instead.

Resolve `SKILL_DIRECTORY` from the absolute path of this SKILL.md. For a launch request, the first operational action is to run this command from the user's project directory:

```sh
node "SKILL_DIRECTORY/scripts/scribble.mjs" start --detach --no-open
```

The app is bundled and requires Node.js 22+. The launcher already checks the server, starts or reuses it, and selects a session. Run it directly; source inspection, project exploration, builds, dependency installation, and separate server checks are unnecessary before launch. If an error requires investigation, read [server lifecycle and recovery](references/server-lifecycle.md).

### Optional commands

Use the word after the skill name to select the action. In Claude Code it arrives as skill arguments; in Codex it is part of the user's message. Use only the corresponding command below, not arbitrary argument text as shell code.

| Invocation suffix | Action |
| --- | --- |
| No suffix, or `start` | Run the launch command above. Resume a draft or recover unread feedback. |
| `start --new` | Add `--new` to the launch command. Open a fresh draft and preserve prior feedback. |
| `status` | Run `node "SKILL_DIRECTORY/scripts/scribble.mjs" status`, summarize the result, and stop. |
| `stop` | Wait for **Draft saved** if the user is editing, then run `node "SKILL_DIRECTORY/scripts/scribble.mjs" stop`. Report the result and stop. |

Keep the working directory fixed. Use the same `--dir PATH` on every command if custom storage was requested; concurrent agents need separate storage directories. Leave the server running after feedback unless asked to stop it. Before a known version upgrade, wait for **Draft saved** in active tabs and reload them afterward.

## Open and collect

1. If startup returns `action: "read-feedback"`, read [the feedback workflow](references/feedback.md) and recover each `pendingFeedback` entry with `feedback --session ID`. Do not silently discard unread feedback or force a new draft.
2. Otherwise, open the exact returned `url` in the available browser and share the link immediately. Preserve its token fragment. Tell the user: **Paste or drop screenshots, add marks and comments, then choose Send to agent.** They can also choose **Capture live app**; read [live capture](references/live-capture.md) only when helping with webpage, shared-tab, or simulator capture.
3. Run `node "SKILL_DIRECTORY/scripts/scribble.mjs" wait --session SESSION_ID --timeout 60` using the returned session ID. Keep a yielded process alive until it returns. Exit code 2 means no submission yet; repeat while the user is giving feedback. Honor cancellation or a new user instruction.
4. Once feedback arrives, read [the feedback workflow](references/feedback.md). Inspect the brief and every original image before acknowledging receipt with `ack --session SESSION_ID`, then apply the requested changes. Saved drafts and submissions survive interruptions.
