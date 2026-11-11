import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";
import type { DeliveryReceipt, FeedbackDelivery } from "../editorHost";

export function PluginDelivery({
  delivery: host,
  onDelivered,
}: {
  delivery: FeedbackDelivery;
  onDelivered: (delivered: boolean) => void;
}) {
  const [state, setState] = useState<
    | "checking"
    | "ready"
    | "sending"
    | "queued"
    | "blocked"
    | "accepted"
    | "read"
  >("checking");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const applyReceipt = (receipt: DeliveryReceipt) => {
    setState(
      receipt.readAt
        ? "read"
        : receipt.acceptedAt
          ? "accepted"
          : receipt.error
            ? "blocked"
            : receipt.queuedAt
              ? "queued"
              : "ready",
    );
    setError(receipt.error || "");
    setConnected(receipt.connected !== false);
  };
  const delivered = state === "accepted" || state === "read";
  useEffect(() => {
    onDelivered(delivered);
  }, [delivered, onDelivered]);
  useEffect(() => {
    if (
      !host.canSend ||
      !["checking", "queued", "blocked", "accepted"].includes(state)
    )
      return;
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const receipt = await host.deliveryStatus();
        if (active) {
          applyReceipt(receipt);
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
            disabled={state !== "ready" && state !== "blocked"}
            onClick={() => {
              setState("sending");
              setError("");
              void host
                .sendFeedback()
                .then(() => host.deliveryStatus())
                .then(applyReceipt, (error) => {
                  setState("ready");
                  setError(
                    `${error.message || "Could not confirm delivery."} If no message appeared in the chat, copy the handoff below.`,
                  );
                });
            }}
          >
            <Send size={18} aria-hidden="true" />
            {state === "checking"
              ? "Checking delivery…"
              : state === "sending"
                ? "Sending…"
                : state === "queued"
                  ? "Feedback queued"
                  : state === "blocked"
                    ? "Retry sending"
                    : "Send to this chat"}
          </button>
          <p className="handoff-status" role="status">
            {state === "queued"
              ? connected
                ? "Your feedback is saved and queued for this chat. It will be delivered when the agent is ready."
                : "Your feedback is saved. Reopen the originating Claude Code chat with Scribble enabled to deliver it."
              : "Send your finished feedback to the conversation that opened this canvas."}
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
