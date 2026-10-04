---
version: 1
slug: "src-components-capturepanel-tsx"
primary_target: "src/components/CapturePanel.tsx"
related_targets: ["src/components/LiveView.tsx", "src/styles.css", "src/App.tsx"]
---

# Embedded live capture

Mode: Operate. Scope: select a webpage or booted simulator, interact with its live screen inside Scribble, and capture a still for the existing annotation editor.

## Direction contract

THESIS: Keep the live screen central so navigating to a moment and marking it feel like adjacent steps in the same workspace.
OWN-WORLD: Preserve the Working Sketchbook system from DESIGN.md: warm paper, cream fields, dark ink, cobalt actions and selection, system sans, compact controls, and thin separators. The source screen supplies the visual content; its colors and typography do not become Scribble tokens.
STORY: Choose a source, connect, navigate directly in the embedded screen, then Capture & annotate. Earlier stills retain their marks and comments. Return to live capture when another image is needed.
FIRST VIEWPORT: Before connection, a centered source form introduces the task. Once connected, compact Back and source controls sit above a settings sidebar and a large live screen. The live toolbar carries the source title, navigation, reconnect, and capture action.
FORM: This is an extension of the incumbent Operate surface. No new visual world, brand asset, or global palette is introduced.

## Layout and controls

- Before connection, the form is at most 680px wide. Webpage settings include the URL, discovered local apps, and viewport dimensions. Simulator settings include the booted-device selector. First-use setup and recovery copy use the existing hint and error treatments.
- Connected content expands to at most 1440px. The desktop grid uses a 180–230px settings column, a flexible preview column, and a 24px gap. Settings use a native disclosure: open before connection and initially collapsed after connection, with the summary available to reopen them.
- Connected mode hides the introductory paragraph and visually hides the page heading while retaining it for focus and accessibility. Back and source controls share a compact top row when space permits.
- The live toolbar wraps its title and controls. Webpages expose Back and Reload; simulators expose Home. Reconnect view (webpage), Reconnect simulator, and Capture & annotate remain beside the source controls. The capture action uses the incumbent cobalt treatment with a surface-specific 44px minimum height.
- The live screen is a flat warm staging area with a thin border. Streamed frames retain their aspect ratio and fit the available width; the desktop height limit is the greater of 260px and the viewport height minus 270px. This sizing gives the screen priority without adding decorative framing.
- At 980px and below, settings and preview stack with a 12px gap. At 600px and below, the capture action spans the toolbar width and the live image is limited to 55vh. Text roles retain their existing sizes; controls wrap instead of shrinking type.
- The desktop capture workspace scrolls within the application frame when content extends below the screen. On mobile, the page grows vertically so help, optional text entry, disconnect, and refresh follow the image.
- Interaction help sits below the screen. A collapsed “Type or paste text” disclosure contains an optional text field and secondary action. Disconnect and Refresh sources remain quiet text actions.

## Interaction and state

- The embedded source is a stream of screen images, with pointer, scroll, and keyboard input sent back to the running app. It is distinct from the frozen image used for annotations.
- Clicking or tapping the image focuses live interaction. Users can drag, scroll, type, or paste; Escape releases interaction and leaves screen focus. The live screen uses the existing cobalt focus outline. Optional text entry supports typing without keeping the screen focused.
- Connecting and disconnected states use plain status or recovery text in the screen area. Reconnect view restarts the view. Source controls and capture are disabled while the screen is unavailable or input is pending, according to each control's behavior.
- A detected Xcode Device Hub input conflict shows a diagnostic and disables interaction while screen capture remains available. Reconnect simulator checks the condition again after repair.
- Hidden tabs pause the stream; returning restarts it. Pointer interaction is released on focus loss, hidden tabs, cancellation, and unmounting.
- Capture & annotate creates a still for the existing editor. The running source and earlier captures remain separate, so later navigation does not change prior feedback.

## Design reconciliation

The new surface reuses the existing primary, secondary, icon, text-action, field, hint, and error vocabulary. The source sidebar, responsive live canvas, disclosure controls, and 44px capture action are local composition decisions, not changes to the global system. DESIGN.md and its sidecar remain the visual authority.

No new raster brand asset is introduced. Live frames and screenshots are session content or verification evidence.

## Verification evidence

Reconciled on 2026-10-03 against CapturePanel.tsx, LiveView.tsx, the effective CSS cascade, and real iPhone 17 simulator captures:

- [Desktop capture](../review/embedded-simulator-desktop.png): the settings disclosure occupies the narrow left column; the source title, Home, Reconnect view, and cobalt capture action sit above a centered portrait screen. The source image fits above the application footer in the captured viewport.
- [Mobile capture](../review/embedded-simulator-mobile.png): Back and source selection wrap into successive rows, settings remain collapsible, capture spans the width above the screen, and the lower help and text disclosure remain in the document flow.

These images verify the connected simulator composition. Webpage clicking and typing were also verified in the in-app browser; [webpage capture](../review/embedded-web-desktop.png) records that result. No global design-token change follows from this reconciliation.
