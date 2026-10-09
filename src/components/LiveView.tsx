import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Home, RefreshCw } from "lucide-react";
import { request, apiResponse } from "../api";
import { readLiveFrames } from "../liveStream";
import { createImageSource, releaseImageSource } from "../imageSource";
import type { CaptureKind } from "../types";

type Input = {
  type: string;
  phase?: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  key?: string;
  text?: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
};
type Props = {
  kind: CaptureKind;
  title: string;
  generation: number;
  inputWarning?: string;
  onReconnect?: () => Promise<void>;
  busy: boolean;
  onCapture: () => Promise<void>;
  onError: (message: string) => void;
};

export function LiveView({
  kind,
  title,
  busy,
  onCapture,
  onError,
  generation,
  inputWarning,
  onReconnect,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string>();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    let currentUrl = "",
      previousUrl = "",
      lastFrame = 0,
      active = true;
    let watchdog = window.setTimeout(
      () =>
        abort.abort(
          new Error("The live stream timed out. Reconnect to try again."),
        ),
      15000,
    );
    setReady(false);
    setFailed(false);
    void apiResponse(`/capture/stream?kind=${kind}&generation=${generation}`, {
      signal: abort.signal,
    })
      .then((response) =>
        readLiveFrames(response, (bytes) => {
          clearTimeout(watchdog);
          watchdog = window.setTimeout(
            () =>
              abort.abort(
                new Error("The live stream stopped. Reconnect to try again."),
              ),
            20000,
          );
          if (performance.now() - lastFrame < 65) return;
          lastFrame = performance.now();
          releaseImageSource(previousUrl);
          previousUrl = currentUrl;
          currentUrl = createImageSource(bytes, "image/jpeg");
          setFrameUrl(currentUrl);
        }),
      )
      .catch((error) => {
        if (!active) return;
        if (abort.signal.aborted && abort.signal.reason?.name === "AbortError")
          return;
        setFailed(true);
        setReady(false);
        errorHandler.current((abort.signal.reason || error).message);
      });
    return () => {
      active = false;
      abort.abort();
      clearTimeout(watchdog);
      releaseImageSource(currentUrl);
      releaseImageSource(previousUrl);
    };
  }, [kind, generation, attempt, visible]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState("");
  const image = useRef<HTMLImageElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const lastPoint = useRef({ x: 0.5, y: 0.5 });
  const queue = useRef<Input[]>([]);
  const running = useRef(false);
  const mounted = useRef(true);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const send = useCallback(
    (input: Input) => {
      const last = queue.current.at(-1);
      if (
        input.type === "pointer" &&
        input.phase === "move" &&
        last?.type === "pointer" &&
        last.phase === "move"
      )
        queue.current[queue.current.length - 1] = input;
      else if (input.type === "wheel" && last?.type === "wheel") {
        last.dx = Math.max(
          -2000,
          Math.min(2000, (last.dx || 0) + (input.dx || 0)),
        );
        last.dy = Math.max(
          -2000,
          Math.min(2000, (last.dy || 0) + (input.dy || 0)),
        );
      } else {
        if (
          queue.current.length >= 64 &&
          input.type !== "release" &&
          input.phase !== "up"
        )
          return;
        queue.current.push(input);
      }
      if (running.current) return;
      running.current = true;
      if (mounted.current) setPending(true);
      void (async () => {
        try {
          while (queue.current.length) {
            const next = queue.current.shift()!;
            await request("/capture/input", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, generation, ...next }),
              signal: AbortSignal.timeout(20000),
            });
          }
        } catch (error) {
          queue.current = [];
          // A failed up request must never leave a mouse button or touch held.
          void request("/capture/input", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, generation, type: "release" }),
            keepalive: true,
          }).catch(() => {});
          if (mounted.current) errorHandler.current((error as Error).message);
        } finally {
          running.current = false;
          if (mounted.current) setPending(false);
        }
      })();
    },
    [kind, generation],
  );
  const release = useCallback(() => {
    if (pointer.current === null) return;
    pointer.current = null;
    send({ type: "release" });
  }, [send]);
  useEffect(() => {
    mounted.current = true;
    const blur = () => release();
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      queue.current = [];
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [release]);
  useEffect(() => {
    const node = surface.current;
    const wheel = (event: WheelEvent) => {
      if (!ready || failed || busy || inputWarning) return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1;
      send({
        type: "wheel",
        dx: Math.max(-2000, Math.min(2000, event.deltaX * scale)),
        dy: Math.max(-2000, Math.min(2000, event.deltaY * scale)),
      });
    };
    node?.addEventListener("wheel", wheel, { passive: false });
    return () => node?.removeEventListener("wheel", wheel);
  }, [send, ready, failed, busy, inputWarning]);
  const point = (event: React.PointerEvent) => {
    const rect = image.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const available = ready && !failed && !busy;
  const enabled = available && !inputWarning;
  return (
    <section className="live-view" aria-label="Embedded live view">
      <div className="live-toolbar">
        <h2>
          <span className="connected-dot" />
          {title}
        </h2>
        <div className="live-controls">
          {kind === "web" ? (
            <>
              <button
                className="icon-button"
                aria-label="Go back in webpage"
                disabled={!enabled || pending}
                onClick={() => send({ type: "back" })}
              >
                <ArrowLeft size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Reload webpage"
                disabled={!enabled || pending}
                onClick={() => send({ type: "reload" })}
              >
                <RefreshCw size={19} />
              </button>
            </>
          ) : (
            <>
              <button
                className="icon-button"
                aria-label="Simulator home"
                disabled={!enabled || pending}
                onClick={() => send({ type: "home" })}
              >
                <Home size={19} />
              </button>
            </>
          )}
          <button
            className="text-button"
            disabled={busy || pending}
            aria-label={onReconnect ? "Reconnect simulator" : "Reconnect view"}
            onClick={() => {
              if (onReconnect) {
                void onReconnect();
                return;
              }
              release();
              errorHandler.current("");
              setReady(false);
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Reconnect
          </button>
        </div>
        <button
          className="primary capture-submit"
          disabled={!available || pending}
          onClick={() => void onCapture()}
        >
          <Camera size={18} />
          Capture & annotate
        </button>
      </div>

      {inputWarning && (
        <p className="capture-error" role="status">
          {inputWarning}
        </p>
      )}
      <div
        className={`live-screen live-screen-${kind}`}
        ref={surface}
        tabIndex={0}
        role="application"
        aria-label={`Interactive ${kind === "web" ? "webpage" : "simulator"} screen`}
        aria-describedby="live-help"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            release();
            event.currentTarget.blur();
            return;
          }
          if (
            !enabled ||
            event.nativeEvent.isComposing ||
            ["Meta", "Control", "Alt", "Shift"].includes(event.key)
          )
            return;
          if (
            (event.metaKey || event.ctrlKey) &&
            ["v", "c"].includes(event.key.toLowerCase())
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          send({
            type: "key",
            key: event.key,
            control: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
            alt: event.altKey,
          });
        }}
        onPaste={(event) => {
          if (!enabled) return;
          event.preventDefault();
          send({ type: "text", text: event.clipboardData.getData("text") });
        }}
        onBlur={release}
      >
        {!ready && !failed && (
          <p className="live-placeholder" role="status">
            {visible
              ? "Connecting live screen…"
              : "Live view paused while this tab is hidden."}
          </p>
        )}
        {failed && (
          <p className="live-placeholder" role="alert">
            The live view disconnected. Choose Reconnect to try again.
          </p>
        )}
        <img
          ref={image}
          src={frameUrl}
          alt={`Live ${kind === "web" ? "webpage" : "simulator"} screen`}
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => {
            setFailed(true);
            setReady(false);
            release();
          }}
          onPointerDown={(event) => {
            if (!enabled || event.button !== 0 || pointer.current !== null)
              return;
            event.preventDefault();
            surface.current?.focus({ preventScroll: true });
            pointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            lastPoint.current = point(event);
            send({ type: "pointer", phase: "down", ...lastPoint.current });
          }}
          onPointerMove={(event) => {
            if (pointer.current !== event.pointerId) return;
            lastPoint.current = point(event);
            send({ type: "pointer", phase: "move", ...lastPoint.current });
          }}
          onPointerUp={(event) => {
            if (pointer.current !== event.pointerId) return;
            pointer.current = null;
            send({ type: "pointer", phase: "up", ...point(event) });
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (pointer.current === event.pointerId) release();
          }}
          onLostPointerCapture={(event) => {
            if (pointer.current === event.pointerId) release();
          }}
        />
      </div>
      <p id="live-help" className="capture-hint">
        Click or tap the screen to interact. Scroll or drag to move. Type while
        the screen is focused; Escape leaves it.
      </p>
      <details className="live-type-disclosure">
        <summary>Type or paste text</summary>
        <form
          className="live-type"
          onSubmit={(event) => {
            event.preventDefault();
            if (text) {
              send({ type: "text", text });
              setText("");
            }
          }}
        >
          <label className="sr-only" htmlFor="live-text">
            Text to type in the app
          </label>
          <input
            id="live-text"
            placeholder="Type or paste text into the app"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            disabled={!enabled}
          />
          <button className="secondary" disabled={!enabled || pending || !text}>
            Type text
          </button>
        </form>
      </details>
    </section>
  );
}
