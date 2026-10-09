# Live capture

When the user requests a running webpage or simulator, open **Capture live app** in Scribble. Selecting **Open webpage** or **Connect simulator** installs missing tools automatically. To prepare tools ahead of time or recover a failed installation, run the relevant command:

```sh
node "SKILL_DIRECTORY/scripts/scribble.mjs" setup web
node "SKILL_DIRECTORY/scripts/scribble.mjs" setup simulator
```

Replace `SKILL_DIRECTORY` with its resolved absolute path. Pass the same `--dir` used for startup. Web setup installs Playwright and Chromium; simulator setup installs serve-sim. These downloads are only needed for the requested capture source. After setup, select **Refresh sources**.

- **Webpage:** Best for local apps. Check **Running on this Mac** for local apps, or enter any public or local HTTP/HTTPS URL. Select **Open webpage**. Scribble streams a background browser directly into its canvas, including sites that block iframe embedding. Click, scroll, and type in this view, then select **Capture & annotate**. Its temporary profile has separate login state. Other browser tabs do not change the capture target.
- **Shared browser tab:** Prefer this secondary flow for hosted sites, existing logins, or looping bot checks. Open the same session link in Chrome or Edge, preserving its token fragment, then choose **Webpage → Share browser tab**. The user chooses a tab in the browser picker and navigates in that original tab. Scribble displays a view-only live stream and saves selected frames for annotation. No Playwright setup is needed. Sharing continues while annotating; **Stop sharing**, submission, or closing the tab ends it. Shared capture metadata includes the display surface and time, but no URL or scroll position; do not invent these. If the in-app browser lacks screen sharing, use **Copy session link** and open it in Chrome or Edge.
- **Simulator:** Requires an Apple Silicon Mac, Xcode, and a booted simulator. Build and launch the app with the project’s normal tools when requested. Select the device and **Connect simulator**. Tap and drag on the screen embedded in Scribble, then select **Capture & annotate**. Scribble reuses or starts serve-sim; no separate preview window or serve-sim skill is required. Simulator keyboard forwarding supports US keyboard characters.

Direct webpage and simulator input is active only in the live view. Click the screen before typing, or expand **Type or paste text**. Escape releases keyboard focus. **Reconnect** retries an interrupted stream. Hidden tabs pause streaming.
Each capture is a frozen image. The user can annotate it and select **Resume live capture** for another screen. Earlier images and marks remain unchanged. Selecting **Close webpage** clears its temporary login state. Disconnecting a simulator leaves the simulator and shared preview running. A Scribble restart requires reconnecting sources; saved captures remain available.

If capture reports an old or mismatched server, run the launcher again and reload the browser tab. For a pre-versioning server that fails its health check, inspect the reported PID and command before stopping it. Preserve the storage directory and restart with the recorded port and session so the user’s draft and browser backup remain available. Verify the current browser session after an upgrade, not only a separate test server.

### Xcode 27 input recovery

If Scribble reports that Device Hub disabled simulator input, streams and screenshots still work. The serve-sim repair restarts the simulator system UI and closes running apps. Ask the user before running `serve-sim repair-input -d DEVICE_ID` through the installed capture runtime; do not reset input automatically. After approval, repair only the affected device, reconnect its serve-sim helper, reopen the user's app, and verify a tap changes the embedded screen. Select **Reconnect** to clear the diagnostic.
