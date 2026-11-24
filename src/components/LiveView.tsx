import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { ArrowLeft, Camera, Home, RefreshCw, ScanLine } from "lucide-react";
import { captureCommand, liveFrames } from "../api";
import { createImageSource, releaseImageSource } from "../imageSource";
import { getEditorHost } from "../editorHost";
import type { CaptureKind } from "../types";
import { ViewportPicker, type Viewport } from "./ViewportPicker";

import type { CaptureInput as Input } from "../../skills/scribble/scripts/lib/capture/contracts.mjs";
type Props = {
  kind: CaptureKind;
  title: string;
  generation: number;
  inputWarning?: string;
  onReconnect?: () => Promise<void>;
  busy: boolean;
  onCapture: (fullPage?: boolean) => Promise<void>;
  onError: (message: string) => void;
  viewport?: Viewport;
  onViewportChange: (viewport: Viewport) => void;
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
  viewport,
  onViewportChange,
}: Props) {
  const retries = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string>();
  const frameCanvas = useRef<HTMLCanvasElement>(null);
  const useCanvas = kind === "simulator" && !!getEditorHost();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    // The embedded host can return the same data URL after reconnect. Clear
    // the previous source so the first frame triggers onLoad again.
    setFrameUrl(undefined);
    setReady(false);
    setFailed(false);
    if (!visible) return;
    const canvas = frameCanvas.current;
    const context = canvas?.getContext("2d", { alpha: false });
    const abort = new AbortController();
    let currentUrl = "",
      previousUrl = "",
      lastFrame = -Infinity,
      active = true;
    let retryTimer: number | undefined;
    function interrupted(error: Error) {
      if (!active) return;
      clearTimeout(watchdog);
      setReady(false);
      setFailed(true);
      if (kind === "simulator") {
        retryTimer = window.setTimeout(
          () => setAttempt((n) => n + 1),
          Math.min(5000, 300 * 2 ** Math.min(5, retries.current++)),
        );
      } else errorHandler.current(error.message);
    }
    let watchdog = window.setTimeout(
      () =>
        abort.abort(
          new Error("The live stream timed out. Reconnect to try again."),
        ),
      15000,
    );
    void (async () => {
      for await (const bytes of liveFrames(kind, generation, abort.signal)) {
        if (!active) return;
        clearTimeout(watchdog);
        watchdog = window.setTimeout(
          () =>
            abort.abort(
              new Error("The live stream stopped. Reconnect to try again."),
            ),
          20000,
        );
        if (
          !bytes ||
          (kind === "simulator" &&
            !useCanvas &&
            performance.now() - lastFrame < 32)
        )
          continue;
        retries.current = 0;
        lastFrame = performance.now();
        const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
        if (canvas && context) {
          const bitmap = await createImageBitmap(
            new Blob([bytes as BlobPart], { type: mime }),
          );
          try {
            if (!active) return;
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            context.drawImage(bitmap, 0, 0);
            setReady(true);
          } finally {
            bitmap.close();
          }
          continue;
        }
        if (canvas)
          throw new Error(
            "Could not draw the simulator preview. Try reconnecting.",
          );
        releaseImageSource(previousUrl);
        previousUrl = currentUrl;
        currentUrl = createImageSource(bytes, mime);
        setFrameUrl(currentUrl);
      }
      interrupted(new Error("The live stream ended."));
    })().catch((error) => {
      if (!active) return;
      if (abort.signal.aborted && abort.signal.reason?.name === "AbortError")
        return;
      interrupted(abort.signal.reason || error);
    });
    return () => {
      active = false;
      clearTimeout(retryTimer);
      abort.abort();
      clearTimeout(watchdog);
      releaseImageSource(currentUrl);
      releaseImageSource(previousUrl);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [kind, generation, attempt, visible, useCanvas]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const lastPoint = useRef({ x: 0.5, y: 0.5 });
  const wheelEnd = useRef<(() => void) | null>(null);
  const queue = useRef<Input[]>([]);
  const running = useRef<Promise<void> | null>(null);
  const inputFailed = useRef(false);
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
        last.dx = Math.max(-2000, Math.min(2000, last.dx + input.dx));
        last.dy = Math.max(-2000, Math.min(2000, last.dy + input.dy));
      } else {
        if (
          queue.current.length >= 64 &&
          input.type !== "release" &&
          !(input.type === "pointer" && input.phase === "up")
        )
          return;
        queue.current.push(input);
      }
      if (running.current) return;
      if (kind === "web" && mounted.current) setPending(true);
      running.current = (async () => {
        try {
          while (queue.current.length) {
            const next = queue.current.shift()!;
            await captureCommand(
              {
                action: "input",
                kind,
                generation,
                ...next,
              },
              { signal: AbortSignal.timeout(20000) },
            );
          }
          if (mounted.current && inputFailed.current) {
            inputFailed.current = false;
            errorHandler.current("");
          }
        } catch (error) {
          inputFailed.current = true;
          queue.current = [];
          // A failed up request must never leave a mouse button or touch held.
          void captureCommand(
            {
              action: "input",
              kind,
              generation,
              type: "release",
            },
            { keepalive: true },
          ).catch(() => {});
          if (mounted.current) errorHandler.current((error as Error).message);
        } finally {
          running.current = null;
          if (kind === "web" && mounted.current) setPending(false);
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
    const blur = () => {
      wheelEnd.current?.();
      release();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      queue.current = [];
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      // An up sample can still be queued after the DOM pointer was released.
      if (pointer.current !== null || running.current) {
        pointer.current = null;
        send({ type: "release" });
      }
    };
  }, [release, send]);
  const simulatorActionPending = kind === "simulator" && pending;
  useEffect(() => {
    const node = surface.current;
    let contact: { x: number; y: number } | undefined;
    let wheelTimer: number;
    let residualX = 0,
      residualY = 0;
    const end = () => {
      clearTimeout(wheelTimer);
      if (contact) send({ type: "pointer", phase: "up", ...contact });
      contact = undefined;
      residualX = residualY = 0;
    };
    wheelEnd.current = end;
    const wheel = (event: WheelEvent) => {
      if (
        !ready ||
        failed ||
        busy ||
        inputWarning ||
        !node ||
        simulatorActionPending
      )
        return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node.clientHeight
            : 1;
      const dx = event.deltaX * scale,
        dy = event.deltaY * scale;
      if (kind === "web") {
        send({
          type: "wheel",
          dx: Math.max(-2000, Math.min(2000, dx)),
          dy: Math.max(-2000, Math.min(2000, dy)),
        });
        return;
      }
      if (
        pointer.current !== null ||
        !(
          event.target instanceof HTMLCanvasElement ||
          event.target instanceof HTMLImageElement
        )
      )
        return;
      const rect = event.target.getBoundingClientRect();
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(end, 100);
      residualX += dx;
      residualY += dy;
      // Ignore a trackpad's subpixel tail. A stationary down/up would be a tap.
      if (!contact && Math.hypot(residualX, residualY) < 3) return;
      const clamp = (value: number) => Math.min(0.995, Math.max(0.005, value));
      if (
        contact &&
        ((contact.y <= 0.005 && dy > 0) ||
          (contact.y >= 0.995 && dy < 0) ||
          (contact.x <= 0.005 && dx > 0) ||
          (contact.x >= 0.995 && dx < 0))
      ) {
        send({ type: "pointer", phase: "up", ...contact });
        contact = undefined;
      }
      if (!contact) {
        // Leave enough room for a pan to be recognized even near the bezel.
        const anchor = (position: number, delta: number) =>
          delta > 0
            ? Math.max(0.12, clamp(position))
            : delta < 0
              ? Math.min(0.88, clamp(position))
              : clamp(position);
        contact = {
          x: anchor((event.clientX - rect.left) / rect.width, residualX),
          y: anchor((event.clientY - rect.top) / rect.height, residualY),
        };
        send({ type: "pointer", phase: "down", ...contact });
      }
      const from = contact;
      contact = {
        x: clamp(from.x - residualX / rect.width),
        y: clamp(from.y - residualY / rect.height),
      };
      residualX = residualY = 0;
      send({ type: "pointer", phase: "move", ...contact });
    };
    node?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node?.removeEventListener("wheel", wheel);
      end();
      wheelEnd.current = null;
    };
  }, [kind, send, ready, failed, busy, inputWarning, simulatorActionPending]);
  const point = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  async function afterSimulatorGesture(action: () => Promise<void>) {
    if (kind !== "simulator") return action();
    wheelEnd.current?.();
    release();
    setPending(true);
    try {
      const drain = running.current;
      if (drain) await drain;
      if (mounted.current) await action();
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  const available = ready && !failed && !busy;
  const enabled = available && !inputWarning && !simulatorActionPending;
  const pointerHandlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.button !== 0 || pointer.current !== null) return;
      event.preventDefault();
      wheelEnd.current?.();
      surface.current?.focus({ preventScroll: true });
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      lastPoint.current = point(event);
      send({ type: "pointer", phase: "down", ...lastPoint.current });
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (pointer.current !== event.pointerId) return;
      lastPoint.current = point(event);
      send({ type: "pointer", phase: "move", ...lastPoint.current });
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (pointer.current !== event.pointerId) return;
      pointer.current = null;
      send({ type: "pointer", phase: "up", ...point(event) });
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      if (pointer.current === event.pointerId) release();
    },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      if (pointer.current === event.pointerId) release();
    },
  };
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
                onClick={() => {
                  wheelEnd.current?.();
                  release();
                  send({ type: "home" });
                }}
              >
                <Home size={19} />
              </button>
            </>
          )}
          <button
            className={kind === "simulator" ? "icon-button" : "text-button"}
            title={kind === "simulator" ? "Reconnect simulator" : undefined}
            disabled={busy || pending}
            aria-label={onReconnect ? "Reconnect simulator" : "Reconnect view"}
            onClick={() => {
              if (onReconnect) {
                void afterSimulatorGesture(onReconnect);
                return;
              }
              release();
              errorHandler.current("");
              setReady(false);
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            {kind === "simulator" ? <RefreshCw size={17} /> : "Reconnect"}
          </button>
        </div>
        {kind === "web" && (
          <button
            className="secondary capture-submit"
            disabled={!available || pending}
            onClick={() => void onCapture(true)}
          >
            <ScanLine size={18} />
            Capture full page & annotate
          </button>
        )}
        <button
          className="primary capture-submit"
          aria-label="Capture & annotate"
          disabled={!available || pending}
          onClick={() => void afterSimulatorGesture(onCapture)}
        >
          <Camera size={18} />
          <span>
            Capture
            <span className="capture-action-suffix"> &amp; annotate</span>
          </span>
        </button>
      </div>

      {kind === "web" && viewport && (
        <ViewportPicker
          viewport={viewport}
          disabled={busy || pending}
          onChange={onViewportChange}
        />
      )}
      <div
        className={`live-screen live-screen-${kind}`}
        ref={surface}
        tabIndex={inputWarning ? -1 : 0}
        role={inputWarning ? "group" : "application"}
        aria-label={`${inputWarning ? "Preview of" : "Interactive"} ${kind === "web" ? "webpage" : "simulator"} screen`}
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
          <p
            className="live-placeholder"
            role={kind === "simulator" ? "status" : "alert"}
          >
            {kind === "simulator"
              ? "Reconnecting to the simulator…"
              : "The live view disconnected. Choose Reconnect to try again."}
          </p>
        )}
        {useCanvas ? (
          <canvas
            ref={frameCanvas}
            width={0}
            height={0}
            role="img"
            aria-label="Live simulator screen"
            {...pointerHandlers}
          />
        ) : (
          <img
            style={
              kind === "web" && viewport
                ? { maxWidth: `min(100%, ${viewport.width}px)` }
                : undefined
            }
            src={frameUrl}
            alt={`Live ${kind === "web" ? "webpage" : "simulator"} screen`}
            draggable={false}
            onLoad={() => setReady(true)}
            onError={() => {
              setFailed(true);
              setReady(false);
              release();
            }}
            {...pointerHandlers}
          />
        )}
      </div>
      <p
        id="live-help"
        className={
          kind === "simulator" && !inputWarning ? "sr-only" : "capture-hint"
        }
      >
        {inputWarning ||
          "Click or tap the screen to interact. Scroll or drag to move. Type while the screen is focused. Escape leaves it."}
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
