---
version: 1
slug: "src-components-capturepanel-tsx"
primary_target: "src/components/CapturePanel.tsx"
related_targets: ["src/components/LiveView.tsx", "src/components/ViewportPicker.tsx", "src/components/SharedTabView.tsx", "src/useTabShare.ts", "src/styles.css", "src/App.tsx"]
---

# Embedded live capture

Mode: Operate. Scope: connect a webpage or simulator, or share an existing browser tab, then capture a still for the annotation editor.

## Direction contract

THESIS: Give the live screen the working area and keep source controls compact.
OWN-WORLD: Preserve the Working Sketchbook: warm paper, cream fields, dark ink, cobalt actions and selection, system sans, and thin separators. Source content does not supply application tokens.
STORY: Choose a source, reach the desired moment, Capture & annotate, then return for another still. Earlier images retain their marks and comments.
FIRST VIEWPORT: Before connection, a centered form introduces the task. Connected mode uses one full-width column: compact Back and source selection, collapsed settings above the preview, then the live toolbar and screen.
FORM: Extend the incumbent identity. DESIGN.md and its sidecar remain the global visual authority.

## Layout and controls

- Setup is at most 800px wide; connected content uses the full available width. There is no settings sidebar. Direct-source settings open before connection and collapse after connection. Connected webpage settings retain the source URL in their summary.
- Webpage setup puts the URL and Open action together, followed by a local-app-first hint, discovered apps, viewport presets, and a collapsed custom viewport-size disclosure. Hosted sites and existing logins have a secondary Share browser tab entry. Simulator setup selects a booted device. Refresh belongs with settings.
- Direct webpages offer Desktop (1920 × 1080), Laptop (1280 × 900), Tablet (768 × 1024), and Phone (390 × 844) before connection and immediately above the connected screen. Laptop is the initial size. Compact icon-and-label buttons reuse pale cobalt selection and cobalt ink, expose pressed state, and sit beside a dimensions readout. Custom dimensions remain in Webpage settings → Viewport size; connected users select Apply size. A custom size leaves all presets unselected.
- Connected mode visually hides the introduction and page heading. The toolbar keeps source title, navigation, Reconnect, and Capture & annotate above the screen. Webpage controls offer Back and Reload; simulator controls offer Home. Capture has a 44px minimum height; adjacent navigation targets are at least 40px.
- Images and shared video sit in a flat warm stage with a thin border, preserve aspect ratio, and fit the width. The desktop media height limit is the greater of 300px and the viewport height minus 300px. The workspace scrolls when content exceeds the viewport.
- At 600px and below, the page has 16px insets, the URL field and Open action occupy separate rows, the capture action spans the toolbar, and media is limited to 58dvh. The four viewport presets occupy equal columns with icons above labels; the dimensions readout wraps below. Source URLs truncate in the compact summary. Text-entry controls wrap, and the secondary sharing entry stacks its copy above a full-width action. At 440px and below, connected Back and source tabs occupy separate rows. At 980px and below, discovered app titles and URLs stack. Existing text sizes remain intact.
- Direct interaction help and an optional Type or paste text disclosure follow the screen. Disconnect remains a quiet text action. Shared mode instead places a view-only instruction above the video and provides Choose another tab and Stop sharing controls.

## Direct capture behavior

- Local apps are the preferred URL flow. Pointer, scroll, keyboard, and paste input act on the embedded webpage or simulator. Focusing the screen enables keyboard interaction; Escape releases it. The existing cobalt outline identifies focus.
- Connecting and disconnected states use status or recovery text. Reconnect restarts the view or simulator connection. A detected simulator input conflict explains the restriction and disables interaction while keeping capture available.
- Hidden tabs pause the direct stream; returning restarts it. Focus loss and cancellation release active pointer input. Capture creates a frozen image for annotation while the source remains available.
- Changing a connected webpage's viewport resizes the existing page and restarts its stream without navigating or clearing form input. Presets are unavailable while resizing; failures retain the last applied selection and display recovery text. Captures record the selected dimensions, and earlier images retain their original dimensions, marks, and comments. Returning from annotation retains the live source's size.

## Shared browser flow

- The secondary flow guides users to open Scribble and their signed-in site in Chrome or Edge, then choose a tab in the browser's sharing picker. Unsupported browsers receive a Copy session link action and an explanation. No audio is requested.
- The shared preview is view only: users click, type, and scroll in the original tab. The title distinguishes a browser tab, window, or screen when the browser reports the surface type. Capture is available once a live frame is ready.
- Viewport presets apply only to direct webpage capture. Shared browser tabs retain the original tab's viewport, and simulator sizing continues to follow its selected device.
- Sharing survives capture, annotation, and switching capture modes. Outside the shared preview, a pale cobalt status banner provides Return to shared tab and Stop sharing. This persistence lasts within the open Scribble page; it does not imply restoration after a reload.
- Sharing ends through Stop sharing, the browser's own stop control, submission, or closing the Scribble page. Replacing the shared source stops the previous stream after a new one is obtained. Cancellation and permission failures leave explanatory status text. Previously captured images remain saved.
- Only captured frames enter the local annotation session; the shared stream is not stored as a recording.

## Verification evidence

Reconciled on 2026-10-03 against CapturePanel, LiveView, SharedTabView, useTabShare, sharing lifecycle integration, and effective CSS.

- [Webpage desktop](../review/capture-desktop.png) and [mobile](../review/capture-mobile.png) show settings above the full-width preview, compact navigation, and the secondary sharing entry.
- [Real simulator wide](../review/capture-simulator-wide.png) and [narrow](../review/capture-simulator-narrow.png) show the final single-column composition and compact toolbar, with the device title, Home, Reconnect, and Capture & annotate above the screen.
- [Native shared-tab capture](../review/shared-tab-native.png) shows the view-only instruction, shared preview, source replacement, explicit stop, and capture action. Static captures document composition; sharing persistence and shutdown behavior were reconciled from code.

Viewport extension reconciled on 2026-11-05 against ViewportPicker, CapturePanel, LiveView, effective CSS, the webpage resize implementation, and capture tests. Compared with the incumbent surface, this adds compact viewport controls while preserving the warm paper, system sans, cobalt selection, full-width preview, and existing simulator/shared workflows.

- [Desktop viewport](../review/viewport-desktop.png) and [phone viewport](../review/viewport-phone.png) show selected controls, dimensions, and differently proportioned live screens with preserved form content. [Mobile workspace](../review/viewport-mobile.png) shows the four equal preset columns, stacked icon labels, wrapped readout, and full-width capture action at 390px.
- Finish disposition: SHIP, with no material findings. Reported validation passed: production build, 34 Node tests, 28 capture/plugin browser tests, and a clean diff whitespace check. Browser coverage includes all presets, custom dimensions, resize failure and recovery, preserved input, capture, resume, and no horizontal overflow on the mobile workspace. Backend coverage verifies retained navigation/form state and immutable earlier captures.
- This narrow extension preserves PRODUCT.md, DESIGN.md, and `.impeccable/design.json`. The context loader's preexisting design-sidecar drift remains unchanged; it is outside this surface update.

This update records surface layout and behavior only. It introduces no global palette, typography, or brand-asset change. Source frames and review screenshots remain session content or verification evidence.
