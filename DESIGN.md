---
name: Scribble
description: A warm sketchbook for precise screenshot feedback.
colors:
  blue: "#3456c4"
  blue-light: "#eaf0ff"
  blue-hover: "#2747ae"
  blue-active: "#203c99"
  paper: "#f6f3ec"
  panel: "#fdfcf8"
  rail: "#f4f1e9"
  overall: "#faf8f2"
  line: "#e3dfd5"
  ink: "#34322e"
  muted: "#767168"
  muted-small: "#70685c"
  white: "#ffffff"
  comment-active: "#f0f3fc"
  field-line: "#ded8cd"
  field-focus: "#c4cfea"
  count-surface: "#e9e5dc"
  count-ink: "#736e65"
  coral-ink: "#c94b35"
  blue-ink: "#3559c7"
  green-ink: "#267052"
  purple-ink: "#8753af"
  saved-ink: "#637363"
  error-ink: "#923922"
  error-surface: "#f9e6dd"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.24
    letterSpacing: "-0.9px"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    letterSpacing: "-0.3px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  annotation:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 700
  brand:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.8125rem"
    fontWeight: 750
  receipt:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "2.625rem"
    fontWeight: 650
rounded:
  key: "4px"
  count: "5px"
  icon: "6px"
  tool: "7px"
  field: "8px"
  action: "9px"
  popover: "12px"
  dock: "13px"
  circle: "50%"
spacing:
  tight: "4px"
  small: "8px"
  label: "12px"
  row: "16px"
  section: "20px"
  rail-inset: "22px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.blue-hover}"
  button-primary-active:
    backgroundColor: "{colors.blue-active}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 18px"
  button-text:
    textColor: "#696357"
    padding: "5px"
  button-tool:
    textColor: "#686257"
    rounded: "{rounded.tool}"
    width: "36px"
    height: "37px"
    padding: "0"
  button-tool-selected:
    backgroundColor: "{colors.blue-light}"
    textColor: "{colors.blue}"
  input-overall:
    backgroundColor: "{colors.panel}"
    textColor: "#4d473e"
    rounded: "{rounded.field}"
    padding: "11px"
  count:
    backgroundColor: "{colors.count-surface}"
    textColor: "{colors.count-ink}"
    rounded: "{rounded.count}"
    height: "24px"
  comment-row:
    backgroundColor: "{colors.panel}"
    padding: "17px 22px 16px"
  comment-row-selected:
    backgroundColor: "{colors.comment-active}"
  screenshot-navigation:
    backgroundColor: "{colors.rail}"
    padding: "23px 14px 18px"
  annotation-badge:
    backgroundColor: "{colors.coral-ink}"
    textColor: "{colors.white}"
    typography: "{typography.annotation}"
    rounded: "{rounded.circle}"
    size: "28px"
---
# Design System: Scribble

## Overview

**Creative North Star: "The Working Sketchbook"**

Warm paper, dark ink, and compact rounded tools frame the screenshot. Cobalt identifies the main action and selected controls; four annotation inks connect marks with their matching comments. The interface is quiet enough to keep image content central.

This is a desktop-first working surface with precise numbered feedback and light sketchbook cues: a dotted canvas, a tilted pencil icon, and a small rotated empty-state tile. The shipped wordmark uses the system sans; no handwritten font is installed. The selected direction is user-pinned, and the implementation was developed code-first.

**Key Characteristics:**
- Warm paper with cream working panels.
- Compact rounded controls and thin separators.
- Cobalt selection and action; distinct colored annotation ink.
- Stable numbered marks linked to comments.
- Desktop rails become a stacked mobile workspace.

Extracted from `src/styles.css`, `src/App.tsx`, `src/components/`, and `src/types.ts`; visually checked against `.impeccable/review/desktop.png`, `mobile.png`, and `empty.png`. The finish verdict is `ship` after keyboard and muted-text corrections. Tokens describe the finished interface. Spacing entries name recurring measurements rather than a new enforced grid.

## Colors

Warm neutrals carry the workspace; saturated ink makes actions and marks easy to locate. Frontmatter values are normative.

### Primary

- **Cobalt (`blue`)** identifies upload and send actions, selection, caret, and focus. Its hover and active siblings darken the same interaction.
- **Pale cobalt (`blue-light`)** sits behind selected drawing tools. **Comment selection (`comment-active`)** lightly connects the active feedback row to its mark.

### Secondary

- **Coral, blue, green, and purple ink** belong to annotation strokes, numbered badges, and ink choices. These colors are not severity states. The blue annotation ink intentionally differs from the application cobalt.
- **Saved ink** communicates the local draft state. The error surface and ink pair communicate a failure that needs attention.

### Neutral

- **Paper** is the main canvas; **panel** is the header, comments rail, controls, and footer.
- **Rail** grounds screenshot navigation; **overall** gently separates the overall-message and send area.
- **Ink** carries primary text. **Muted** carries supporting copy; **muted-small** is the darker tone used in small hints, metadata, and placeholders after the contrast repair.
- **Line** divides permanent regions. **Field line** encloses the overall textarea; **field focus** marks focused comment editing. Count surface and ink distinguish compact quantity badges.
- **White** supplies button and annotation-number text, image staging, and focused comment backgrounds.

**The Cobalt Control Rule.** Use cobalt for primary actions, selected tools, selected screenshot borders, and keyboard focus. Annotation blue remains its own ink token.

The sidecar's eight-step OKLCH ramps are generated inspection aids. They are not additional shipping palette tokens.

## Typography

The native system sans family remains the sole typeface. No font download is required. The root uses `100%` so browser font preferences apply, and named CSS roles use rem units.

- **Reading text:** 1rem (16px at the default browser setting), weight 400, with 1.6 line height. Comments, overall feedback, and explanatory paragraphs share this role.
- **Labels and metadata:** 0.875rem (14px), the smallest application text. Filenames, status, hints, counts, shortcuts, and footer text retain this size on mobile. Labels use weight 600 when they introduce a group.
- **Section titles:** 1.25rem (20px), weight 650. Feedback and shortcut headings have a clear step above body text.
- **Page headings:** 1.875rem (30px), weight 650, with restrained negative tracking. The wordmark keeps its 1.8125rem (29px), weight 750 treatment. The receipt heading keeps its 2.625rem (42px) scale.
- **Actions:** 1rem (16px), weight 600. Secondary text actions use the label role.

Prose outside the rails is limited to 50–60ch where space permits. The narrow feedback rail naturally has shorter lines; empty feedback copy can use its full width up to 48ch. Repeated roles do not shrink at responsive breakpoints. Width, wrapping, spacing, and scrolling accommodate larger text instead.

**The Numbered Mark Rule.** Keep the mark number and ink consistent between the image and its comment. SVG badge text remains 14 screen pixels and scales inversely with image zoom. Comment badges use the matching label role. Screenshot content, including the fictional example, has its own typography and is not part of this application scale.

## Layout

The desktop application fills the viewport height with a minimum height of 700px. A 77px header and a footer at least 40px tall bound three working columns: 176px screenshot rail, flexible canvas, and 360px feedback rail. Comments scroll independently; the overall-message form stays at the bottom of its rail.

At widths up to 1150px the rail widths become 160px and 340px and the dock compacts. At 1600px and above they become 192px and 380px. At 980px and below the layout becomes a vertical stack: horizontal screenshot strip, 570px canvas, feedback, and submission. The header has a 65px minimum height; header and footer content can wrap. At 440px and below the canvas row is 505px and the dock can wrap.

The canvas dot grid repeats every 18px. A centered floating dock sits 65px above the canvas bottom on desktop, 53px on mobile, and 48px at the smallest breakpoint. The image transform is centered horizontally and anchored at 43% of the available viewport height. Screenshot and comment spacing is compact, with larger clear space around the image.

## Elevation & Depth

Permanent regions use tonal layering and one-pixel separators. Only the central image, floating controls, help panel, and receipt previews have soft shadows. The dot grid is a faint registration aid, not a simulated paper photograph.

### Shadow Vocabulary

- **Floating surface:** `0 8px 26px #49402a14` for the dock and receipt previews.
- **Image:** `0 10px 35px #4e443d1c` under the screenshot.
- **Help panel:** `0 12px 45px #453c2926` for the temporary shortcut panel.
- **Upload action:** `0 3px 7px #3456c41a` for the empty-state action.

**The Floating Tool Rule.** Use soft ambient shadows for the dock, image, and temporary help panel. The permanent rails rely on warm surfaces and thin separators.

## Shapes

Compact controls use modest radii: the field and thumbnail radius, action radius, and dock radius distinguish their roles without pill styling. Counts use smaller rounded squares. Annotation and comment numbers are circles. The add-image control and drag overlay use dashed borders; normal rails and fields use solid borders.

Lucide icons render as SVG strokes. The logo's pencil is tilted by nine degrees and the empty-state image tile by seven degrees. These small accents establish the sketchbook character without rotating working controls or screenshot content.

## Components

### Buttons

Primary actions are compact cobalt rectangles with white text, a 46px minimum height, and a nine-pixel radius. Hover and pressed states darken the fill. Secondary controls use cream, a thin line border, and an eight-pixel radius. Text buttons remain light and gain cobalt text on hover.

Buttons, links, and textareas use a three-pixel cobalt focus outline offset by three pixels. Most disabled buttons use 0.4 opacity; disabled Send uses an opaque warm gray treatment. Never infer a saved or sent state from a decorative color alone.

### Drawing Dock and Ink Choices

The cream floating dock groups six drawing tools, four ink choices, and undo/redo with thin vertical separators. Default tool targets are 36px by 37px; the compact breakpoints use smaller targets. Selected tools have pale cobalt fill and cobalt SVG strokes. Ink choices use filled circles and an outer ring for selection. Every icon button carries an accessible name; toggle buttons expose pressed state.

### Counts and Screenshot Navigation

Small rounded quantity badges summarize screenshots and marks. Screenshot thumbnails preserve image aspect ratio with `object-fit: contain`; the selected thumbnail gains a cobalt border, number tile, and filename. The remove button appears on hover or focus on desktop and is always visible on mobile. The add-image target is dashed, with an icon and label.

### Cards / Containers

Comments are flush rows in the feedback rail, separated by thin rules. They are not floating cards. Selection tints the whole row. The help panel is the reusable rounded floating container. Screenshot thumbnails are content previews; do not borrow the fictional example's project cards as application components.

### Inputs / Fields

Individual comment fields are transparent at rest, with 16px text and a 1.6 line height. Focus adds a white background, pale blue border, and inset horizontal padding. The overall field uses the cream panel fill, warm border, eight-pixel radius, 16px text, and a 1.6 line height. Both resize vertically within capped heights; placeholders use the repaired dark muted tone.

### Numbered Annotations

Pins, arrows, rectangles, and freehand strokes share colored circular number badges. Badge radius is 14 screen pixels, annotation stroke width is three screen pixels, and number text is 14 screen pixels regardless of zoom. Selection adds a translucent white halo. Keyboard focus darkens the badge stroke and adds a soft drop shadow. Enter and Space select marks; ordinary buttons retain native keyboard activation. Space-to-pan is scoped to the canvas viewport and excludes interactive controls.

The shipped `pin-pop` animation scales from 0.72 to 1 while changing opacity from 0.6 to 1 over 180ms. Selected SVG badges use a centered fill-box transform origin. The receipt uses the same pop over 300ms. Save activity pulses opacity. Color transitions take 160ms with `ease`. Reduced-motion preference disables animations and transitions.

No external raster artwork ships as part of this visual system. The example screenshot is a fictional UI generated at runtime by `src/example.ts`; uploaded screenshots and review captures are session or verification data. They are not reusable brand assets.

## Do's and Don'ts

### Do:

- Do keep screenshot content central and use the warm paper and cream panel tokens for the application frame.
- Do use numbered, color-matched marks and comments; keep annotation geometry legible across zoom levels.
- Do preserve visible focus, native keyboard button activation, and reduced motion support.
- Do use the darker muted-small token for small labels and placeholders on paper, panel, and overall-message surfaces.
- Do adapt the rails into the documented mobile stack while preserving drawing, feedback, and submission controls.

### Don't:

- Don't copy typography or colors from uploaded screenshots or the fictional example into the application system.
- Don't extend the dotted canvas texture into text-entry fields or comment rows.
- Don't use annotation ink as the default application action color.
- Don't add hard offset shadows or decorative card stacks to the quiet working frame.


Not canonized: the directional handwritten wordmark did not ship; the implemented logo uses system sans with a rotated pencil icon. The large system-font receipt heading is recorded only as an existing one-off, not a display-family rule. These observations do not change the finish review's resolved-fix ship verdict.
