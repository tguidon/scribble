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
  useEffect(() => {
    const setDisplayMode = (mode?: string) => {
      document.documentElement.dataset.displayMode = mode || "inline";
    };
    app.onhostcontextchanged = (context) => {
      if (context.displayMode) setDisplayMode(context.displayMode);
    };
    app.ontoolresult = (result) => {
      const value = result._meta?.scribble as Connection | undefined;
      if (value?.sessionId && value.token && value.url) setConnection(value);
    };
    void app
      .connect()
      .then(() => {
        setDisplayMode(app.getHostContext()?.displayMode);
        if (!app.getHostCapabilities()?.serverTools)
          setError(
            "This host cannot connect the Scribble editor to its tools. Use the browser link in the tool result.",
          );
        void app.sendSizeChanged({ height: 760 }).catch(() => {});
      })
      .catch(() =>
        setError(
          "Could not connect Scribble to this chat. Reopen Scribble or use the browser link in the tool result.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!connection) return;
    const host = createEditorHost(connection, setConnection);
    setEditorHost(host);
    setReady(connection.sessionId);
    return () => host.dispose();
  }, [connection]);
  if (error)
    return (
      <main className="receipt">
        <h1>Open Scribble in your browser.</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!connection || ready !== connection.sessionId)
    return (
      <main className="receipt">
        <h1>Scribble</h1>
        <p role="status">Connecting your canvas to this chat…</p>
      </main>
    );
  return <App key={ready} />;
}
createRoot(document.getElementById("root")!).render(<PluginEditor />);
