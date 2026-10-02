import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ImagePlus,
  Minus,
  Plus,
  Scan,
  Upload,
  ArrowUpRight,
} from "lucide-react";
import type { Annotation, Point, Screenshot, Tool } from "../types";
import { imageUrl } from "../api";
import { AnnotationShape } from "./AnnotationShape";
import { frameBatcher } from "../frameBatcher.mjs";
type Props = {
  image?: Screenshot;
  tool: Tool;
  color: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMark: (mark: Annotation) => void;
  onUpload: () => void;
  onExample: () => void;
  disabled: boolean;
  children: React.ReactNode;
};
export function Canvas({
  image,
  tool,
  color,
  selected,
  onSelect,
  onMark,
  onUpload,
  onExample,
  disabled,
  children,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ghost, setGhost] = useState<Annotation>();
  const ghostUpdates = useMemo(() => frameBatcher<Annotation>(setGhost), []);
  const clearGhost = useCallback(() => {
    ghostUpdates.cancel();
    setGhost(undefined);
  }, [ghostUpdates]);
  useEffect(() => () => ghostUpdates.cancel(), [ghostUpdates]);
  const [space, setSpace] = useState(false);
  const gesture = useRef<
    { start: Point; pan: Point; mark?: Annotation; moving: boolean } | undefined
  >(undefined);
  const fit = image
    ? Math.min(
        (size.width - 80) / image.width,
        (size.height - 155) / image.height,
        1,
      )
    : 1;
  const scale = Math.max(0.02, fit) * zoom;
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    clearGhost();
    gesture.current = undefined;
  }, [image?.id, clearGhost]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as Element).closest(
          "button,a,input,textarea,select,[contenteditable],[role=button]",
        )
      )
        return;
      if (e.code === "Space" && viewport.current?.contains(e.target as Node)) {
        e.preventDefault();
        setSpace(true);
      }
      if (e.key === "Escape") {
        gesture.current = undefined;
        clearGhost();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [clearGhost]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      if (!image) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        setZoom((z) =>
          Math.max(0.25, Math.min(5, z * (event.deltaY > 0 ? 0.92 : 1.08))),
        );
      else setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => element?.removeEventListener("wheel", wheel);
  }, [image]);
  const point = (event: React.PointerEvent): Point => {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(image!.width, (event.clientX - bounds.left) / scale),
      ),
      y: Math.max(
        0,
        Math.min(image!.height, (event.clientY - bounds.top) / scale),
      ),
    };
  };
  function down(event: React.PointerEvent) {
    if (
      !image ||
      disabled ||
      event.button !== 0 ||
      (event.target as Element).closest("button")
    )
      return;
    if (tool === "pan" || space) {
      viewport.current!.setPointerCapture(event.pointerId);
      gesture.current = {
        start: { x: event.clientX, y: event.clientY },
        pan,
        moving: true,
      };
      event.preventDefault();
      return;
    }
    if (!svg.current?.contains(event.target as Node)) return;
    if (tool === "select") {
      if (!(event.target as Element).closest(".annotation")) onSelect(null);
      return;
    }
    svg.current?.focus({ preventScroll: true });
    const p = point(event);
    const mark: Annotation = {
      id: crypto.randomUUID(),
      type: tool,
      color,
      points: [p],
      comment: "",
    };
    viewport.current!.setPointerCapture(event.pointerId);
    gesture.current = { start: p, pan, moving: false, mark };
    ghostUpdates.schedule(mark);
    event.preventDefault();
  }
  function move(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (g.moving) {
      setPan({
        x: g.pan.x + event.clientX - g.start.x,
        y: g.pan.y + event.clientY - g.start.y,
      });
      return;
    }
    if (!g.mark || !image) return;
    const p = point(event);
    if (g.mark.type === "pin") return;
    if (g.mark.type === "freehand") {
      const last = g.mark.points.at(-1)!;
      if (
        Math.hypot(last.x - p.x, last.y - p.y) * scale < 2 ||
        g.mark.points.length >= 5000
      )
        return;
      g.mark = { ...g.mark, points: [...g.mark.points, p] };
    } else g.mark = { ...g.mark, points: [g.start, p] };
    ghostUpdates.schedule(g.mark);
  }
  function finish(event: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = undefined;
    clearGhost();
    if (viewport.current?.hasPointerCapture(event.pointerId))
      viewport.current.releasePointerCapture(event.pointerId);
    if (!g?.mark) return;
    const mark = g.mark;
    if (
      mark.type === "pin" ||
      (mark.points.length > 1 &&
        mark.points.some(
          (p) =>
            Math.hypot(p.x - mark.points[0].x, p.y - mark.points[0].y) * scale >
            3,
        ))
    )
      onMark(mark);
  }
  return (
    <section className="canvas-area" aria-label="Screenshot canvas">
      <div className="canvas-heading">
        <span>{image ? image.name : "Your canvas"}</span>
        {image && (
          <span className="image-dimensions">
            {image.width} × {image.height}
          </span>
        )}
      </div>
      <div
        ref={viewport}
        className={`viewport tool-${space ? "pan" : tool}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => {
          gesture.current = undefined;
          clearGhost();
        }}
      >
        {image ? (
          <div
            className="image-transform"
            style={{
              width: image.width,
              height: image.height,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          >
            <svg
              ref={svg}
              className="image-stage"
              viewBox={`0 0 ${image.width} ${image.height}`}
              width={image.width}
              height={image.height}
              tabIndex={0}
              aria-label={`${image.name}. Choose a drawing tool and drag to mark. Press Enter to add a pin at the center.`}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  e.target === e.currentTarget &&
                  !disabled
                ) {
                  e.preventDefault();
                  onMark({
                    id: crypto.randomUUID(),
                    type: "pin",
                    color,
                    points: [{ x: image.width / 2, y: image.height / 2 }],
                    comment: "",
                  });
                }
              }}
            >
              <image
                href={imageUrl(image.id)}
                width={image.width}
                height={image.height}
              />
              {image.annotations.map((mark, i) => (
                <AnnotationShape
                  key={mark.id}
                  mark={mark}
                  number={i + 1}
                  scale={scale}
                  selected={selected === mark.id}
                  onSelect={tool === "select" ? onSelect : undefined}
                />
              ))}
              {ghost && (
                <AnnotationShape
                  mark={ghost}
                  number={image.annotations.length + 1}
                  scale={scale}
                />
              )}
            </svg>
          </div>
        ) : (
          <div className="empty-canvas">
            <div className="empty-symbol">
              <ImagePlus size={35} strokeWidth={1.5} />
              <span className="sample-pin">1</span>
            </div>
            <h1>
              A picture. A few marks.
              <br />
              <span>A much clearer idea.</span>
            </h1>
            <p>
              Drop a screenshot here and show your agent
              <br className="desktop-break" /> exactly what you have in mind.
            </p>
            <button
              className="primary upload-primary"
              onClick={onUpload}
              disabled={disabled}
            >
              <Upload size={17} />
              Add screenshots
            </button>
            <span className="file-hint">
              or paste with <kbd>⌘</kbd> <kbd>V</kbd> · PNG, JPG, WebP
            </span>
            <button
              className="text-button example-button"
              onClick={onExample}
              disabled={disabled}
            >
              Try an example <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>
      {children}
      <div className="canvas-bottom">
        <span>
          {image
            ? "Mark it up. Make it clear."
            : "A little less explaining. A little more showing."}
        </span>
        {image && (
          <div className="zoom-controls">
            <button
              aria-label="Zoom out"
              disabled={zoom <= 0.25}
              onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
            >
              <Minus size={14} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              aria-label="Zoom in"
              disabled={zoom >= 5}
              onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
            >
              <Plus size={14} />
            </button>
            <button
              aria-label="Fit screenshot"
              title="Fit screenshot"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <Scan size={15} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
