import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  ImagePlus,
  X,
  AlertCircle,
  PencilLine,
  Maximize2,
} from "lucide-react";
import { FeedbackReceipt } from "./components/FeedbackReceipt";
import { BrandIcon } from "./components/BrandIcon";
import { Canvas } from "./components/Canvas";
import { CapturePanel } from "./components/CapturePanel";
import { Toolbar } from "./components/Toolbar";
import { useTabShare } from "./useTabShare";
import {
  useEditorController,
  type EditorController,
} from "./useEditorController";
import { ScreenshotRail } from "./components/ScreenshotRail";
import { FeedbackPanel } from "./components/FeedbackPanel";
import { getEditorHost } from "./editorHost";
import { exampleFile } from "./example";
import type { Annotation, Tool } from "./types";
export default function App({ active = true }: { active?: boolean } = {}) {
  const controller = useEditorController();
  return active ? <Editor controller={controller} /> : null;
}

function Editor({ controller }: { controller: EditorController }) {
  const host = getEditorHost();
  const {
    session,
    error,
    setError,
    saveState,
    recovery,
    downloadRecovery,
    useSavedDraft,
    flush,
    working,
    submitted,
    disabled,
    captureOpen,
    setCaptureOpen,
    webMode,
    setWebMode,
    captureKind,
    setCaptureKind,
    image,
    selected,
    setSelected,
    tool,
    setTool,
    color,
    setColor,
    undo,
    redo,
    canUndo,
    canRedo,
    addFiles,
    captureImage,
  } = controller;
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const tabShare = useTabShare();
  useEffect(() => controller.endEdit, [controller.endEdit]);
  useEffect(() => {
    if (submitted) tabShare.stop();
  }, [submitted, tabShare.stop]);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (
        (e.target as HTMLElement).matches(
          "textarea,input,select,[contenteditable]",
        )
      )
        return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches(
          "textarea,input,select,[contenteditable]",
        ) ||
        disabled
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const shortcuts: Record<string, Tool> = {
        v: "select",
        p: "pin",
        a: "arrow",
        r: "rectangle",
        d: "freehand",
        h: "pan",
      };
      if (shortcuts[e.key.toLowerCase()]) {
        setTool(shortcuts[e.key.toLowerCase()]);
        e.preventDefault();
      }
      if (e.key === "Escape") {
        setSelected(null);
        setHelp(false);
      }
    };
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", key);
    };
  }, [addFiles, disabled, undo, redo]);
  const selectMark = useCallback((id: string | null) => {
    setSelected(id);
    if (id)
      requestAnimationFrame(() => {
        const field = document.getElementById(
          `comment-${id}`,
        ) as HTMLTextAreaElement | null;
        field?.focus({ preventScroll: true });
        (field?.closest(".comment") || field)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      });
  }, []);
  const addMark = (mark: Annotation) => {
    if (controller.addMark(mark)) selectMark(mark.id);
  };
  return (
    <div
      className={`app ${dragging ? "dragging" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="app-header">
        <a
          className="brand"
          href={host?.browserUrl || location.href}
          target={host ? "_blank" : undefined}
          rel="noreferrer"
          aria-label="Scribble"
        >
          <BrandIcon />
          <span>
            scribble<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="brand-description">
          Show your agent what you mean.
        </span>
        <div className="header-actions">
          {host?.expand && (
            <button
              className="icon-button"
              aria-label="Expand canvas"
              title="Expand canvas"
              onClick={() =>
                void host.expand!().catch(() =>
                  setError(
                    "This host could not expand the editor. Continue in this panel.",
                  ),
                )
              }
            >
              <Maximize2 size={18} />
            </button>
          )}
          <span
            className={`save-status ${saveState === "offline" ? "offline" : ""}`}
            role="status"
          >
            {saveState === "saved" ? (
              <Check size={14} />
            ) : saveState === "offline" ? (
              <AlertCircle size={14} />
            ) : (
              <span className="status-dot" />
            )}
            {submitted
              ? "Feedback saved"
              : saveState === "loading"
                ? "Opening your canvas…"
                : saveState === "saving"
                  ? "Saving draft…"
                  : saveState === "offline"
                    ? "Not saved to server"
                    : "Draft saved"}
          </span>
          <button
            className="icon-button help-button"
            aria-label="Keyboard shortcuts"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      {tabShare.stream &&
        (!captureOpen || captureKind !== "web" || webMode !== "shared") &&
        !submitted && (
          <div className="sharing-banner" role="status">
            <span>Browser sharing is on.</span>
            <button
              className="text-button"
              onClick={() => {
                setCaptureKind("web");
                setWebMode("shared");
                setCaptureOpen(true);
              }}
            >
              Return to shared tab
            </button>
            <button className="text-button" onClick={tabShare.stop}>
              Stop sharing
            </button>
          </div>
        )}
      {help && (
        <section className="help-panel" aria-label="Keyboard shortcuts">
          <div>
            <h2>A few handy shortcuts</h2>
            <button
              className="icon-button"
              aria-label="Close shortcuts"
              onClick={() => setHelp(false)}
            >
              <X size={17} />
            </button>
          </div>
          <dl>
            {[
              ["V", "Select marks"],
              ["P", "Drop a pin"],
              ["A", "Draw an arrow"],
              ["R", "Draw a rectangle"],
              ["D", "Freehand drawing"],
              ["Space / H", "Pan the canvas"],
              ["⌘Z / Ctrl+Z", "Undo"],
              ["⌘⇧Z / Ctrl+Shift+Z", "Redo"],
              ["Enter on canvas", "Add a centered pin"],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          {recovery && (
            <>
              <button onClick={downloadRecovery}>Download unsaved draft</button>
              <button onClick={useSavedDraft}>Use saved draft</button>
              <details className="recovery-preview">
                <summary>View unsaved draft</summary>
                <p>
                  If the download does not start, copy this backup before using
                  the saved draft.
                </p>
                <textarea
                  aria-label="Unsaved draft backup"
                  readOnly
                  value={JSON.stringify(recovery.draft, null, 2)}
                  rows={8}
                />
              </details>
            </>
          )}
          {!recovery && saveState === "offline" && session && (
            <button
              onClick={() => {
                void flush()
                  .then(() => setError(""))
                  .catch((e) => setError(e.message));
              }}
            >
              Retry save
            </button>
          )}
          {!recovery && (
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {!session ? (
        <main className="opening">
          <PencilLine size={30} />
          <h1>
            {error
              ? "Let’s reconnect your canvas."
              : "Opening your sketchbook…"}
          </h1>
          <p>
            {error
              ? "Open the session link printed by Scribble. Your saved feedback is still on disk."
              : "Your screenshots and saved notes will be right here."}
          </p>
          {error && (
            <button className="secondary" onClick={() => location.reload()}>
              Try again
            </button>
          )}
        </main>
      ) : submitted ? (
        <FeedbackReceipt session={session} />
      ) : captureOpen ? (
        <CapturePanel
          kind={captureKind}
          setKind={setCaptureKind}
          webMode={webMode}
          setWebMode={setWebMode}
          share={tabShare}
          onSharedCapture={(file, surface) =>
            captureImage("shared", file, surface)
          }
          onBack={() => setCaptureOpen(false)}
          onCapture={captureImage}
        />
      ) : (
        <main className="workspace">
          <ScreenshotRail
            controller={controller}
            onUpload={() => input.current?.click()}
          />
          <Canvas
            image={image}
            tool={tool}
            color={color}
            selected={selected}
            onSelect={selectMark}
            onMark={addMark}
            onUpload={() => input.current?.click()}
            onCapture={() => setCaptureOpen(true)}
            onExample={() => {
              void exampleFile()
                .then((f) => addFiles([f]))
                .catch((e) => setError(e.message));
            }}
            disabled={disabled}
          >
            <Toolbar
              tool={tool}
              setTool={setTool}
              color={color}
              setColor={setColor}
              undo={undo}
              redo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              disabled={disabled || !image}
            />
          </Canvas>
          <FeedbackPanel controller={controller} />
        </main>
      )}
      <input
        ref={input}
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-label="Upload screenshots"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      {dragging && !disabled && (
        <div className="drop-overlay">
          <ImagePlus size={42} />
          <h2>Drop it like you mean it.</h2>
          <p>Add your screenshots to this canvas.</p>
        </div>
      )}
      {working && !submitted && (
        <div className="busy-label" role="status">
          <span className="status-dot" />
          Saving your work…
        </div>
      )}
      <footer className="app-footer">
        <span>Made for the moments words don’t quite cover.</span>
        <span>
          Local by design <ArrowUpRight size={12} />
        </span>
      </footer>
    </div>
  );
}
