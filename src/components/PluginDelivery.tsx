import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import { getEditorHost } from "../editorHost";

export function PluginDelivery() {
  const host = getEditorHost()!;
  const [state, setState] = useState<"ready" | "sending" | "accepted" | "read">(
    "ready",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (state !== "accepted") return;
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const receipt = await host.deliveryStatus();
        if (active && receipt.readAt) setState("read");
      } catch {
        /* The durable feedback and copy fallback remain available. */
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state, host]);
  if (!host.canSend)
    return (
      <p className="handoff-status" role="status">
        This host does not support direct messages. Copy the handoff below and
        paste it into this chat.
      </p>
    );
  return (
    <section
      className="plugin-delivery"
      aria-label="Send feedback to this chat"
    >
      <button
        className="primary"
        disabled={state !== "ready"}
        onClick={() => {
          setState("sending");
          setError("");
          void host.sendFeedback().then(
            () => setState("accepted"),
            (error) => {
              setState("ready");
              setError(
                `${error.message || "Could not confirm delivery."} If no message appeared in the chat, copy the handoff below.`,
              );
            },
          );
        }}
      >
        {state === "read" ? <Check size={18} /> : <Send size={18} />}
        {state === "sending"
          ? "Sending…"
          : state === "accepted"
            ? "Message accepted"
            : state === "read"
              ? "Feedback read"
              : "Send to this chat"}
      </button>
      <p className="handoff-status" role="status">
        {state === "accepted"
          ? "The host accepted your message. Waiting for the agent to read the feedback."
          : state === "read"
            ? "The agent retrieved this feedback. Follow its progress in the chat."
            : "Send your finished feedback to the conversation that opened this canvas."}
      </p>
      {error && (
        <p className="handoff-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
