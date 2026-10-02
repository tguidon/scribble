import { memo } from "react";
import { annotationPath } from "../annotationPath.mjs";
import type { Annotation } from "../types";
export const AnnotationShape = memo(function AnnotationShape({
  mark,
  number,
  scale,
  selected = false,
  onSelect,
}: {
  mark: Annotation;
  number: number;
  scale: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const first = mark.points[0];
  const last = mark.points.at(-1)!;
  const stroke = 3 / scale;
  const radius = 14 / scale;
  const path = mark.type === "freehand" ? annotationPath(mark.points) : "";
  const angle = Math.atan2(last.y - first.y, last.x - first.x);
  const head = 14 / scale;
  const arrow = `M ${last.x - head * Math.cos(angle - 0.5)} ${last.y - head * Math.sin(angle - 0.5)} L ${last.x} ${last.y} L ${last.x - head * Math.cos(angle + 0.5)} ${last.y - head * Math.sin(angle + 0.5)}`;
  const badge =
    mark.type === "rectangle"
      ? { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y) }
      : first;
  return (
    <g
      className={`annotation ${selected ? "selected" : ""}`}
      style={{ color: mark.color }}
      role={onSelect ? "button" : undefined}
      aria-label={
        onSelect ? `Mark ${number}: ${mark.comment || mark.type}` : undefined
      }
      tabIndex={onSelect ? 0 : undefined}
      onClick={(e) => {
        if (onSelect) {
          e.stopPropagation();
          onSelect(mark.id);
        }
      }}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(mark.id);
        }
      }}
    >
      {selected && (
        <circle
          cx={badge.x}
          cy={badge.y}
          r={20 / scale}
          fill="white"
          opacity=".85"
        />
      )}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {mark.type === "freehand" && <path d={path} />}
        {mark.type === "arrow" && (
          <>
            <path d={`M ${first.x} ${first.y} L ${last.x} ${last.y}`} />
            <path d={arrow} />
          </>
        )}
        {mark.type === "rectangle" && (
          <rect
            x={Math.min(first.x, last.x)}
            y={Math.min(first.y, last.y)}
            width={Math.abs(last.x - first.x)}
            height={Math.abs(last.y - first.y)}
            rx={2 / scale}
          />
        )}
      </g>
      <circle
        className="mark-badge"
        cx={badge.x}
        cy={badge.y}
        r={radius}
        fill="currentColor"
        stroke="white"
        strokeWidth={2 / scale}
      />
      <text
        x={badge.x}
        y={badge.y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={14 / scale}
        fontWeight="700"
        pointerEvents="none"
      >
        {number}
      </text>
    </g>
  );
});
