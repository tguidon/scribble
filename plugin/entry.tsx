import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import App from "../src/App";
import { setEditorHost } from "../src/editorHost";
import { app, createEditorHost, type Connection } from "./bridge";
import "../src/styles.css";
import "./editor.css";

function PluginEditor() {
  const [connection, setConnection] = useState<Connection>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState("");
  const [displayMode, setDisplayMode] = useState("inline");
  const [connected, setConnected] = useState(false);
  const [opening, setOpening] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const updateDisplayMode = (mode: string) => {
    document.documentElement.dataset.displayMode = mode;
    setDisplayMode(mode);
  };
  useEffect(() => {
    app.onhostcontextchanged = (context) => {
      if (context.displayMode) updateDisplayMode(context.displayMode);
    };
    app.ontoolresult = (result) => {
      const value = result._meta?.scribble as Connection | undefined;
      if (value?.sessionId && value.token && value.url)
        setConnection((previous) =>
          previous?.sessionId === value.sessionId &&
          previous.token === value.token &&
          previous.url === value.url
            ? previous
            : value,
        );
    };
    void app
      .connect()
      .then(() => {
        updateDisplayMode(app.getHostContext()?.displayMode || "inline");
        setConnected(true);
        if (!app.getHostCapabilities()?.serverTools)
          setError(
            "This host cannot connect the Scribble editor to its tools. Use the browser link in the tool result.",
          );
      })
      .catch(() =>
        setError(
          "Could not connect Scribble to this chat. Reopen Scribble or use the browser link in the tool result.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!connected || displayMode !== "inline") return;
    // Only the compact card participates in the conversation's auto sizing.
    const root = document.getElementById("root")!;
    let previous = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === previous) return;
      previous = height;
      void app.sendSizeChanged({ height }).catch(() => {});
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [connected, displayMode]);
  useEffect(() => {
    if (!connection) return;
    const host = createEditorHost(connection, setConnection);
    setEditorHost(host);
    setReady(connection.sessionId);
    return () => host.dispose();
  }, [connection]);
  if (error)
    return (
      <main className="plugin-launcher">
        <h1>Open Scribble in your browser.</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!connection || ready !== connection.sessionId)
    return (
      <main className="plugin-launcher">
        <h1>Scribble</h1>
        <p role="status">Connecting your canvas to this chat…</p>
      </main>
    );
  if (displayMode !== "fullscreen")
    return (
      <main className="plugin-launcher">
        <h1>Scribble</h1>
        <p>
          Open your canvas to capture screens, add notes, and send feedback to
          this chat.
        </p>
        {app
          .getHostContext()
          ?.availableDisplayModes?.includes("fullscreen") && (
          <button
            className="primary"
            disabled={opening || !connected}
            onClick={async () => {
              setOpening(true);
              setLaunchError("");
              try {
                const result = await app.requestDisplayMode({
                  mode: "fullscreen",
                });
                if (result.mode !== "fullscreen")
                  throw new Error("The host did not open the editor.");
                updateDisplayMode(result.mode);
              } catch {
                setLaunchError(
                  "Could not open the editor panel. Try again or open the browser editor.",
                );
              } finally {
                setOpening(false);
              }
            }}
          >
            {opening ? "Opening…" : "Open canvas"}
          </button>
        )}
        {launchError && <p role="alert">{launchError}</p>}
        {(launchError ||
          !app
            .getHostContext()
            ?.availableDisplayModes?.includes("fullscreen")) && (
          <button
            onClick={() =>
              void app
                .openLink({ url: connection.url })
                .catch(() =>
                  setLaunchError(
                    "Could not open the browser editor. Use the browser link in the tool result.",
                  ),
                )
            }
          >
            Open browser editor
          </button>
        )}
      </main>
    );
  return <App key={ready} />;
}
createRoot(document.getElementById("root")!).render(<PluginEditor />);
