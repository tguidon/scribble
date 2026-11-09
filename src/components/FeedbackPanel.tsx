import { Check, ChevronDown, MessageCircle, Trash2 } from "lucide-react";
import { getEditorHost } from "../editorHost";
import type { EditorController } from "../useEditorController";
export function FeedbackPanel({
  controller,
}: {
  controller: EditorController;
}) {
  const host = getEditorHost();
  const {
    session,
    image,
    selected,
    setSelected,
    busy,
    working,
    totalMarks,
    updateComment,
    deleteMark,
    setMessage,
    endEdit,
    submit,
  } = controller;
  if (!session) return null;
  return (
    <aside className="feedback-panel" aria-label="Feedback">
      <div className="feedback-heading">
        <h2>The details</h2>
        <span className="count">{image?.annotations.length || 0}</span>
      </div>
      <p className="panel-intro">A little context goes a long way.</p>
      <div className="comments">
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
                onBlur={endEdit}
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
          onBlur={endEdit}
          onChange={(event) => setMessage(event.target.value)}
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
          {working ? "Saving your feedback…" : "Finish feedback"}
          <Check size={16} />
        </button>
        <span className="send-hint">
          {session.images.length
            ? host || session.deliveryHost
              ? "Next, send the feedback to this chat."
              : "Next, copy the handoff into your agent."
            : "Add a screenshot to get started."}
        </span>
      </div>
    </aside>
  );
}
