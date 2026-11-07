import { useState } from "react";
import { Camera, ChevronDown, Plus, ShieldCheck, X } from "lucide-react";
import { ScreenshotImage } from "./ScreenshotImage";
import type { EditorController } from "../useEditorController";
export function ScreenshotRail({
  controller,
  onUpload,
}: {
  controller: EditorController;
  onUpload: () => void;
}) {
  const {
    session,
    image,
    selectImage,
    busy,
    disabled,
    removeImage,
    setCaptureOpen,
  } = controller;
  const [screenshotsExpanded, setScreenshotsExpanded] = useState(false);
  const [removeId, setRemoveId] = useState<string>();
  if (!session) return null;
  return (
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
                selectImage(item.id);
                setScreenshotsExpanded(false);
              }}
            >
              <div className="thumbnail">
                <ScreenshotImage id={item.id} alt="" retryable={false} />
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
                <button
                  onClick={() => {
                    if (removeImage(item.id)) setRemoveId(undefined);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => setRemoveId(undefined)}>Keep</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="screenshot-actions">
        <button
          className="add-screenshot"
          onClick={() => onUpload()}
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
  );
}
