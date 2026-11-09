import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import { getEditorHost } from "../editorHost";

export function PluginDelivery({
  onDelivered,
}: {
  onDelivered: (delivered: boolean) => void;
}) {
  const host = getEditorHost()!;
  const [state, setState] = useState<
    "checking" | "ready" | "sending" | "accepted" | "read"
  >("checking");
  const [error, setError] = useState("");
  const delivered = state === "accepted" || state === "read";
  useEffect(() => {
    onDelivered(delivered);
  }, [delivered, onDelivered]);
  useEffect(() => {
    if (!host.canSend || (state !== "checking" && state !== "accepted")) return;
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const receipt = await host.deliveryStatus();
        if (active) {
          setState(
            receipt.readAt ? "read" : receipt.acceptedAt ? "accepted" : "ready",
          );
          setError("");
        }
      } catch {
        if (active && state === "checking")
          setError(
            "Could not check delivery yet. Retrying, or copy the handoff below.",
          );
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
    <section className="plugin-delivery" aria-label="Feedback delivery">
      {delivered ? (
        <div className="delivery-status" role="status">
          <span className="delivery-status-label">
            <Check size={18} aria-hidden="true" />
            {state === "read" ? "Feedback read" : "Message accepted"}
          </span>
          <p>
            {state === "read"
              ? "Follow your agent’s progress in the chat."
              : "Waiting for your agent to read the feedback."}
          </p>
        </div>
      ) : (
        <>
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
            <Send size={18} aria-hidden="true" />
            {state === "checking"
              ? "Checking delivery…"
              : state === "sending"
                ? "Sending…"
                : "Send to this chat"}
          </button>
          <p className="handoff-status" role="status">
            Send your finished feedback to the conversation that opened this
            canvas.
          </p>
        </>
      )}
      {error && (
        <p className="handoff-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
