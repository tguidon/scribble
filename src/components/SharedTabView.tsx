import { useEffect, useRef, useState } from "react";
import { Camera, MonitorUp, Copy } from "lucide-react";
import type { TabShare, SharedSurface } from "../useTabShare";

export function SharedTabView({
  share,
  busy,
  onCapture,
}: {
  share: TabShare;
  busy: boolean;
  onCapture: (file: File, surface: SharedSurface) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const supported = !!navigator.mediaDevices?.getDisplayMedia;
  const surface = share.stream
    ?.getVideoTracks()[0]
    ?.getSettings().displaySurface;
  const label =
    surface === "monitor"
      ? "Shared screen"
      : surface === "window"
        ? "Shared window"
        : "Shared browser tab";
  useEffect(() => {
    setReady(false);
    setError("");
    const node = video.current;
    const track = share.stream?.getVideoTracks()[0];
    if (!node || !share.stream || !track) return;
    node.srcObject = share.stream;
    const muted = () => setReady(false);
    const unmuted = () => setReady(node.readyState >= 2);
    track.addEventListener("mute", muted);
    track.addEventListener("unmute", unmuted);
    void node
      .play()
      .catch(() =>
        setError(
          "The preview could not play. Stop sharing and choose the tab again.",
        ),
      );
    return () => {
      track.removeEventListener("mute", muted);
      track.removeEventListener("unmute", unmuted);
      node.srcObject = null;
    };
  }, [share.stream]);
  const capture = async () => {
    const node = video.current;
    const track = share.stream?.getVideoTracks()[0];
    if (
      !node ||
      !track ||
      track.readyState !== "live" ||
      track.muted ||
      node.readyState < 2
    )
      return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = node.videoWidth;
      canvas.height = node.videoHeight;
      if (
        !canvas.width ||
        !canvas.height ||
        canvas.width * canvas.height > 40000000
      )
        throw new Error(
          "Choose a smaller tab or window. Captures can contain up to 40 megapixels.",
        );
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture this frame. Try again.");
      context.drawImage(node, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Could not capture this frame.")),
          "image/png",
        ),
      );
      if (blob.size > 20 * 1024 * 1024)
        throw new Error(
          "This frame exceeds 20 MB. Share a smaller window and try again.",
        );
      await onCapture(
        new File([blob], `${label}.png`, { type: "image/png" }),
        surface === "window" || surface === "monitor" ? surface : "browser",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  };
  return (
    <section
      className="live-view shared-tab-view"
      aria-label="Shared browser tab"
    >
      {share.stream ? (
        <>
          <div className="live-toolbar">
            <h2>
              <span className="connected-dot" />
              {label}
            </h2>
            <div className="live-controls">
              <button
                className="text-button"
                disabled={busy || share.pending}
                onClick={() => void share.start()}
              >
                Choose another tab
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={share.stop}
              >
                Stop sharing
              </button>
            </div>
            <button
              className="primary capture-submit"
              disabled={!ready || busy || capturing || share.pending}
              onClick={() => void capture()}
            >
              <Camera size={18} />
              Capture & annotate
            </button>
          </div>
          <p className="shared-instruction">
            View only here. Click, type, and scroll in the original tab.
          </p>
          <div className="live-screen live-screen-shared">
            <video
              ref={video}
              autoPlay
              muted
              playsInline
              aria-label="Shared tab preview"
              onLoadedData={() => setReady(true)}
            />
            {!ready && (
              <p className="live-placeholder" role="status">
                Waiting for the shared screen… Open the original tab if no
                picture appears.
              </p>
            )}
          </div>
          <p className="capture-hint">
            Sharing stays on while you annotate. Only captured frames are saved
            to this local session.
          </p>
        </>
      ) : (
        <div className="sharing-setup">
          <MonitorUp size={28} />
          <h2>Bring your browser with you.</h2>
          <p>
            For hosted sites, existing logins, or verification checks, share a
            tab from your regular browser.
          </p>
          <ol>
            <li>Open this Scribble session in Chrome or Edge.</li>
            <li>
              Open the website in another tab and complete any sign-in or
              verification there.
            </li>
            <li>Choose that tab in the browser’s sharing picker.</li>
          </ol>
          {!supported && (
            <p className="capture-hint">
              This browser does not support screen sharing. Copy this session’s
              link and open it in Chrome or Edge.
            </p>
          )}
          <div className="sharing-actions">
            <button
              className="primary"
              disabled={!supported || share.pending || busy}
              onClick={() => void share.start()}
            >
              <MonitorUp size={18} />
              {share.pending
                ? "Choose a tab in your browser…"
                : "Share browser tab"}
            </button>
            <button
              className="text-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(location.href)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError("Copy this session’s URL from the address bar."),
                  );
              }}
            >
              <Copy size={16} />
              {copied ? "Link copied" : "Copy session link"}
            </button>
          </div>
          <p className="capture-hint">
            The live view stays on this device. Stop sharing at any time.
          </p>
        </div>
      )}
      {share.message && (
        <p className="capture-hint" role="status">
          {share.message}
        </p>
      )}
      {error && (
        <p className="capture-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
