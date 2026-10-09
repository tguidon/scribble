import { useEffect, useRef, useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { imageUrl, request } from "../api";
import type { Session } from "../types";

export function FeedbackReceipt({ session }: { session: Session }) {
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    request<{ text: string }>("/handoff").then(
      (handoff) => {
        if (!cancelled) setText(handoff.text);
      },
      () => {
        if (!cancelled)
          setLoadError(
            "Your feedback is saved. Could not load the handoff message. Try again.",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  useEffect(() => {
    if (copyError) {
      preview.current?.focus();
      preview.current?.select();
    }
  }, [copyError]);
  async function copy() {
    setCopying(true);
    setCopied(false);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopyError(
        "Clipboard access was blocked. Select and copy the message below, then paste it into your agent.",
      );
    } finally {
      setCopying(false);
    }
  }
  async function newCanvas() {
    setStarting(true);
    setStartError("");
    try {
      const next = await request<{ url: string }>("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      window.location.assign(next.url);
    } catch {
      setStarting(false);
      setStartError(
        "Could not open a new canvas. Your feedback is saved. Try again.",
      );
    }
  }
  const marks = session.images.reduce(
    (count, image) => count + image.annotations.length,
    0,
  );
  return (
    <main className="receipt">
      <div className="receipt-check">
        <Check size={36} />
      </div>
      <h1 ref={heading} tabIndex={-1}>
        Ready for your agent.
      </h1>
      <p>
        Copy the handoff, then paste it into your agent’s chat.
        <br />
        Your screenshots and feedback stay saved on this device.
      </p>
      <div className="receipt-images">
        {session.images.map((image) => (
          <img key={image.id} src={imageUrl(image.id)} alt={image.name} />
        ))}
      </div>
      <div className="receipt-details">
        <span>
          {session.images.length} screenshot
          {session.images.length !== 1 ? "s" : ""}
        </span>
        <span>
          {marks} mark{marks !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="handoff-actions">
        <button
          className="primary"
          onClick={() => void copy()}
          disabled={!text || copying}
        >
          <Copy size={16} />
          {copying ? "Copying…" : copied ? "Copy again" : "Copy for agent"}
        </button>
        <button
          className="secondary"
          onClick={() => void newCanvas()}
          disabled={starting}
        >
          <Plus size={16} />
          {starting ? "Opening…" : "New canvas"}
        </button>
      </div>
      <p className="handoff-status" role="status">
        {copied
          ? "Copied. Paste into your agent to start the next step."
          : !text && !loadError
            ? "Preparing your handoff…"
            : "The handoff contains file paths. Use an agent with access to this device."}
      </p>
      {loadError && (
        <div className="handoff-error" role="alert">
          <p>{loadError}</p>
          <button className="secondary" onClick={() => setAttempt(attempt + 1)}>
            Retry handoff
          </button>
        </div>
      )}
      {copyError && (
        <p className="handoff-error" role="alert">
          {copyError}
        </p>
      )}
      {startError && (
        <p className="handoff-error" role="alert">
          {startError}
        </p>
      )}
      {text && (
        <details
          className="handoff-preview"
          open={copyError ? true : undefined}
        >
          <summary>View handoff message</summary>
          <textarea
            ref={preview}
            aria-label="Handoff message"
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
      <p className="receipt-note">
        Keep going with a new canvas. This feedback and its image paths will
        stay available.
      </p>
    </main>
  );
}
