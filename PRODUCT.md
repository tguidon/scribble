# Scribble

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User-approved recommendation: React and TypeScript, with a small local Node.js server. No hosted services. The user confirmed code-first implementation and the brief’s sketchbook direction.

## Users
People working with coding agents who need to explain visual changes using screenshots.

## Product Purpose
Show your agent what you mean. Screenshot annotations and comments should communicate a change faster than describing its location in prose.

## Operating Context
An agent skill starts a local browser canvas and waits for feedback. Users upload screenshots or capture a webpage or simulator, annotate frozen images, and send a batch back to the agent. The shared app supports Codex and Claude Code. Install with npx skills; the skill is explicitly invoked. The launcher checks whether a healthy local server exists, reuses it, and starts one when needed. The installed skill carries the built web app and Node runtime. Screenshot uploads need no extra dependencies; live capture uses optional Playwright and serve-sim packages.

## Capabilities and Constraints
- Multiple screenshots; pins, arrows, rectangles, and freehand drawing.
- Embedded public and local webpage streams with click, scroll, keyboard input, and URL and viewport capture context.
- Secondary browser tab sharing for hosted sites and existing logins, with a local view-only stream, still capture, and explicit stop control.
- Suggestions from running local development servers and automatic capture-tool setup.
- Simulator capture through serve-sim, with device and orientation context.
- Embedded serve-sim screen streams with tap, drag, Home, and keyboard input.
- Return to a live source for another capture while preserving earlier images and feedback.
- Comments on individual annotations and one overall message.
- Screenshot navigation, undo, zoom, pan, and automatic draft saving.
- A structured bundle with original images, annotation coordinates, comments, and overall feedback.
- Saved feedback survives an interrupted agent session.
- No account, hosted backend, or separate model API key.

## Brand Commitments
Scribble is a playful sketchbook: warm canvas, bright ink, rounded controls, hand-drawn accents, and satisfying interactions. Screenshots stay central; expression belongs in the tools and interactions.

## Evidence on Hand
IDEA.md is the product brief. The repository begins without an existing app, visual assets, or established design system.

## Product Principles
- Keep screenshot content central.
- Tie feedback to precise image locations.
- Preserve work through interruptions.
- Make the handoff understandable to both people and coding agents.

## Open Decisions
Desktop-first is confirmed by the user. No additional platform-specific accessibility requirement was specified; use semantic controls, keyboard access, clear focus, and reduced motion support.
