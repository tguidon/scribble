import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ImagePlus,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  X,
  AlertCircle,
  Download,
  PencilLine,
  Camera,
} from "lucide-react";
import { Canvas } from "./components/Canvas";
import { CapturePanel } from "./components/CapturePanel";
import { Toolbar } from "./components/Toolbar";
import { useTabShare } from "./useTabShare";
import { useSession } from "./useSession";
import { feedbackUrl, imageUrl } from "./api";
import { exampleFile } from "./example";
import {
  INKS,
  type Annotation,
  type Draft,
  type Tool,
  type CaptureKind,
} from "./types";
export default function App() {
  const {
    session,
    error,
    setError,
    saveState,
    busy: working,
    recovery,
    downloadRecovery,
    useSavedDraft,
    change,
    upload,
    capture,
    submit,
    flush,
  } = useSession();
  const busy = working || !!recovery;
  const [captureOpen, setCaptureOpen] = useState(false);
  const [webMode, setWebMode] = useState<"direct" | "shared">("direct");
  const tabShare = useTabShare();
  const [captureKind, setCaptureKind] = useState<CaptureKind>("web");
  const [activeId, setActiveId] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pin");
  const [color, setColor] = useState(INKS[0].color);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [help, setHelp] = useState(false);
  const [screenshotsExpanded, setScreenshotsExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removeId, setRemoveId] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const comments = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const typing = useRef<string | null>(null);
  const image =
    session?.images.find((i) => i.id === activeId) || session?.images[0];
  const totalMarks =
    session?.images.reduce((n, i) => n + i.annotations.length, 0) || 0;
  const submitted = session?.status === "submitted";
  const disabled = busy || !session || submitted || captureOpen;
  useEffect(() => {
    if (submitted) tabShare.stop();
  }, [submitted, tabShare.stop]);
  const currentDraft = useCallback(
    (): Draft => ({ message: session!.message, images: session!.images }),
    [session],
  );
  const checkpoint = useCallback(() => {
    if (!session) return;
    setPast((p) => [...p.slice(-99), currentDraft()]);
    setFuture([]);
  }, [session, currentDraft]);
  const edit = useCallback(
    (next: Draft, record = true) => {
      if (change(next) && record) checkpoint();
    },
    [checkpoint, change],
  );
  const undo = useCallback(() => {
    if (!past.length || disabled) return;
    const previous = past.at(-1)!;
    setFuture((f) => [currentDraft(), ...f]);
    setPast((p) => p.slice(0, -1));
    change(previous);
    setSelected(null);
  }, [past, disabled, currentDraft, change]);
  const redo = useCallback(() => {
    if (!future.length || disabled) return;
    setPast((p) => [...p, currentDraft()]);
    change(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
  }, [future, disabled, currentDraft, change]);
  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || !files.length) return;
      const result = await upload(files);
      setPast([]);
      setFuture([]);
      if (result?.images.length) {
        setActiveId(result.images.at(-1)!.id);
        setSelected(null);
      }
    },
    [disabled, upload],
  );
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
        setRemoveId(undefined);
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
    if (!image || !session || disabled) return;
    if (image.annotations.length >= 500) {
      setError(
        "This screenshot has 500 marks. Add another screenshot to continue.",
      );
      return;
    }
    edit({
      ...currentDraft(),
      images: session.images.map((i) =>
        i.id === image.id ? { ...i, annotations: [...i.annotations, mark] } : i,
      ),
    });
    selectMark(mark.id);
  };
  function updateComment(id: string, value: string) {
    if (typing.current !== id) {
      checkpoint();
      typing.current = id;
    }
    edit(
      {
        ...currentDraft(),
        images: session!.images.map((i) => ({
          ...i,
          annotations: i.annotations.map((a) =>
            a.id === id ? { ...a, comment: value } : a,
          ),
        })),
      },
      false,
    );
  }
  function deleteMark(id: string) {
    edit({
      ...currentDraft(),
      images: session!.images.map((i) => ({
        ...i,
        annotations: i.annotations.filter((a) => a.id !== id),
      })),
    });
    if (selected === id) setSelected(null);
  }
  function removeImage(id: string) {
    change({
      ...currentDraft(),
      images: session!.images.filter((i) => i.id !== id),
    });
    setPast([]);
    setFuture([]);
    setRemoveId(undefined);
    setSelected(null);
  }
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
        <a className="brand" href={location.href} aria-label="Scribble">
          <PencilLine size={24} strokeWidth={2.3} />
          <span>
            scribble<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="brand-description">
          Show your agent what you mean.
        </span>
        <div className="header-actions">
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
              ? "Feedback sent"
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
        <main className="receipt">
          <div className="receipt-check">
            <CheckCheck size={36} />
          </div>
          <h1>Point made.</h1>
          <p>
            Your screenshots and feedback are ready for your agent.
            <br />
            You can return to your conversation.
          </p>
          <div className="receipt-images">
            {session.images.map((i) => (
              <img key={i.id} src={imageUrl(i.id)} alt={i.name} />
            ))}
          </div>
          <div className="receipt-details">
            <span>
              {session.images.length} screenshot
              {session.images.length !== 1 ? "s" : ""}
            </span>
            <span>
              {totalMarks} mark{totalMarks !== 1 ? "s" : ""}
            </span>
            <span>Saved on this device</span>
          </div>
          {session.message && <blockquote>{session.message}</blockquote>}
          <a className="primary" href={feedbackUrl} download>
            <Download size={16} />
            Download feedback
          </a>
          <p className="receipt-note">
            Another round of feedback? Call Scribble again in your agent.
          </p>
        </main>
      ) : captureOpen ? (
        <CapturePanel
          kind={captureKind}
          setKind={setCaptureKind}
          webMode={webMode}
          setWebMode={setWebMode}
          share={tabShare}
          onSharedCapture={async (file, surface) => {
            const result = await capture("shared", file, surface);
            setPast([]);
            setFuture([]);
            setSelected(null);
            setActiveId(result.images.at(-1)?.id);
            setCaptureOpen(false);
          }}
          onBack={() => setCaptureOpen(false)}
          onCapture={async (kind) => {
            const result = await capture(kind);
            setPast([]);
            setFuture([]);
            setSelected(null);
            setActiveId(result.images.at(-1)?.id);
            setCaptureOpen(false);
          }}
        />
      ) : (
        <main className="workspace">
          <nav className="screenshot-rail" aria-label="Screenshots">
            <div className="rail-heading">
              <span>Screenshots</span>
              <span className="count">{session.images.length}</span>
            </div>
            <button
              className="screenshot-toggle"
              aria-label="Screenshots"
              aria-expanded={screenshotsExpanded}
              aria-controls="screenshot-list"
              disabled={!session.images.length}
              onClick={() => setScreenshotsExpanded((open) => !open)}
            >
              Screenshots <span className="count">{session.images.length}</span>
              <ChevronDown size={16} />
            </button>
            <div
              id="screenshot-list"
              className={`screenshot-list ${screenshotsExpanded ? "expanded" : ""}`}
            >
              {session.images.map((item, index) => (
                <div
                  className={`screenshot-item ${image?.id === item.id ? "current" : ""}`}
                  key={item.id}
                >
                  <button
                    className="thumbnail-button"
                    aria-label={`Open ${item.name}`}
                    aria-current={image?.id === item.id ? "true" : undefined}
                    onClick={() => {
                      setActiveId(item.id);
                      setSelected(null);
                      setScreenshotsExpanded(false);
                    }}
                  >
                    <div className="thumbnail">
                      <img src={imageUrl(item.id)} alt="" />
                      <span className="image-number">{index + 1}</span>
                      {item.annotations.length > 0 && (
                        <span className="annotation-count">
                          {item.annotations.length}
                        </span>
                      )}
                    </div>
                    <span className="thumbnail-name">{item.name}</span>
                  </button>
                  <button
                    className="remove-screenshot"
                    aria-label={`Remove ${item.name}`}
                    disabled={busy}
                    onClick={() => setRemoveId(item.id)}
                  >
                    <X size={12} />
                  </button>
                  {removeId === item.id && (
                    <div className="remove-confirm">
                      <span>Remove this screenshot and its marks?</span>
                      <button onClick={() => removeImage(item.id)}>
                        Remove
                      </button>
                      <button onClick={() => setRemoveId(undefined)}>
                        Keep
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="screenshot-actions">
              <button
                className="add-screenshot"
                onClick={() => input.current?.click()}
                disabled={busy}
              >
                <Plus size={21} />
                <span>Add images</span>
              </button>
              <button
                className="capture-shortcut"
                onClick={() => setCaptureOpen(true)}
                disabled={disabled}
              >
                <Camera size={19} />
                <span>
                  {session.images.some((image) => image.source)
                    ? "Resume live capture"
                    : "Capture live app"}
                </span>
              </button>
            </div>
            <div className="rail-footer">
              <ShieldCheck size={16} />
              <span>
                Just you and
                <br />
                your local canvas.
              </span>
            </div>
          </nav>
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
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              disabled={disabled || !image}
            />
          </Canvas>
          <aside className="feedback-panel" aria-label="Feedback">
            <div className="feedback-heading">
              <h2>The details</h2>
              <span className="count">{image?.annotations.length || 0}</span>
            </div>
            <p className="panel-intro">A little context goes a long way.</p>
            <div className="comments" ref={comments}>
              {image?.annotations.length ? (
                image.annotations.map((mark, index) => (
                  <article
                    className={`comment ${selected === mark.id ? "active" : ""}`}
                    key={mark.id}
                  >
                    <div className="comment-header">
                      <button
                        className="comment-number"
                        style={{ background: mark.color }}
                        aria-label={`Select mark ${index + 1}`}
                        onClick={() => setSelected(mark.id)}
                      >
                        {index + 1}
                      </button>
                      <span>
                        {mark.type === "pin"
                          ? "Pin"
                          : mark.type === "freehand"
                            ? "Drawing"
                            : mark.type === "arrow"
                              ? "Arrow"
                              : "Rectangle"}
                      </span>
                      <button
                        className="icon-button delete-mark"
                        aria-label={`Delete mark ${index + 1}`}
                        disabled={busy}
                        onClick={() => deleteMark(mark.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <textarea
                      id={`comment-${mark.id}`}
                      aria-label={`Comment for mark ${index + 1}`}
                      placeholder="What should change here?"
                      maxLength={10000}
                      value={mark.comment}
                      disabled={busy}
                      onFocus={() => setSelected(mark.id)}
                      onBlur={() => {
                        typing.current = null;
                      }}
                      onChange={(e) => updateComment(mark.id, e.target.value)}
                      rows={3}
                    />
                  </article>
                ))
              ) : (
                <div className="comments-empty">
                  <MessageCircle size={25} strokeWidth={1.5} />
                  <h3>Give your marks a voice.</h3>
                  <p>
                    {image
                      ? "Drop a pin or draw on your screenshot. Add a note here to tell your agent what to change."
                      : "Add a screenshot, mark what matters, and leave a note for your agent."}
                  </p>
                  <div className="annotation-example">
                    <span>1</span>
                    <span>“A bit more breathing room here.”</span>
                  </div>
                </div>
              )}
            </div>
            <div className="overall">
              <label htmlFor="overall-message">
                The bigger picture <span>optional</span>
              </label>
              <textarea
                id="overall-message"
                value={session.message}
                maxLength={20000}
                disabled={busy}
                placeholder="What are we working toward? Add any overall direction…"
                onBlur={() => {
                  typing.current = null;
                }}
                onChange={(e) => {
                  if (typing.current !== "overall") {
                    checkpoint();
                    typing.current = "overall";
                  }
                  edit({ ...currentDraft(), message: e.target.value }, false);
                }}
                rows={4}
              />
              <div className="send-summary">
                <span>
                  {session.images.length} screenshot
                  {session.images.length !== 1 ? "s" : ""} · {totalMarks} mark
                  {totalMarks !== 1 ? "s" : ""}
                </span>
                <ChevronDown size={13} />
              </div>
              <button
                className="primary send-button"
                disabled={!session.images.length || busy}
                onClick={() => void submit()}
              >
                {working ? "Saving your feedback…" : "Send to agent"}
                <Send size={16} />
              </button>
              <span className="send-hint">
                {session.images.length
                  ? "Everything goes together in one batch."
                  : "Add a screenshot to get started."}
              </span>
            </div>
          </aside>
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
