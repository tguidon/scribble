---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css"]
---

# Feedback workspace

Mode: Operate. Desktop-first; responsive layouts preserve all controls in narrow Codex split views and on mobile. Scope: the local screenshot annotation and handoff workspace.

## Direction contract
THESIS: A working sketchbook where screenshots occupy the page and marks become precise feedback. The application opens into the task.
OWN-WORLD: Warm paper, dark brown-black ink, cobalt selected controls, coral/blue/green/purple annotation inks, rounded compact tools, readable system sans, handwritten logo accent only.
STORY: Add screenshots, mark details, explain the changes, send one durable batch to the coding agent.
FIRST VIEWPORT: A slim header above a screenshot rail, a spacious central canvas with floating bottom tool dock, and a 360px right comments rail. The overall message and Send to agent action anchor the bottom of that rail. Empty state offers upload, paste, and an explicitly labeled example.
FORM: User-pinned playful sketchbook overrides the direction roll (seed 3d0693bc, assigned index 4). Grounded candidates: sketchbook, contact sheet, design critique wall, proofreader’s margin, storyboard, field notes, print registration sheet. The selected sketchbook carries precise marginal numbering from proofreading. The roll’s botanical folio, catalog wall, monochrome marketing, dance notation, wayfinding, and departure board challengers are declined against the explicit pinned world; keep their disciplines of registration, focus, restraint, mark precision, clear next action, and stable rows respectively. No comp: user explicitly chose code-first.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: a new pin pops into place, its matching comment receives focus, and selecting either connects both. Reduced-motion preference removes the pop. Submission replaces editing with a durable receipt.

Readability refinement: preserve the native system sans and existing copy. Use 14px labels and hints, 16px reading and form text, and 20px section headings at the default browser font setting. Preserve these roles on mobile; resize or wrap containers instead of shrinking text.

Live capture is a companion Operate surface within this workspace. Its source settings, embedded interaction, and responsive layout are recorded in [Embedded live capture](src-components-capturepanel-tsx.md). Capturing a still returns to the existing annotation editor; the live source remains available for another capture.

## Narrow-window layout

At 980px and below, the screenshot rail becomes a compact selector above the canvas. The selector starts collapsed, expands a horizontal thumbnail strip, and closes after choosing an image. Add images and live capture stay visible outside that strip. At 520px and below, these actions move below the selector; expanded thumbnails follow them.

A populated canvas uses the greater of 480px and the viewport height minus 140px. The image centers within its viewport with 32px of fitting allowance per dimension. Drawing tools sit below the image viewport, leaving more room for portrait previews. At 600px and below the dock has two rows: drawing tools first, then inks and history controls. Feedback and submission follow the canvas. Empty entry uses content height and hides disabled drawing and zoom controls.

Keep the established readable text roles. Narrow layouts wrap the header and footer, reduce feedback insets, and keep help scrollable within the window. Receipt spacing compacts below 600px. Coarse-pointer drawing, ink, zoom, and help targets remain at least 44px in each dimension.
