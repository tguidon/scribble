import { join } from "node:path";
import { atomicText } from "./store.mjs";

const round = (value) => Math.round(value * 100) / 100;
const percent = (point, image) => ({
  x: round((point.x / image.width) * 100),
  y: round((point.y / image.height) * 100),
});
const centerOf = (bounds) => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height / 2,
});
function boundsOf(points) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function region(point, image) {
  const column = Math.min(2, Math.floor((point.x / image.width) * 3));
  const row = Math.min(2, Math.floor((point.y / image.height) * 3));
  return [
    ["upper-left", "upper-center", "upper-right"],
    ["middle-left", "center", "middle-right"],
    ["lower-left", "lower-center", "lower-right"],
  ][row][column];
}
function direction(start, end) {
  if (start.x === end.x && start.y === end.y) return "no displacement";
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return [
    "right",
    "down-right",
    "down",
    "down-left",
    "left",
    "up-left",
    "up",
    "up-right",
  ][(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}
function distanceToSegment(point, start, end) {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
          ),
        );
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

// Preserve endpoints and the largest bends, with bounded work and output.
// Report the remaining error so a coarse outline is never mistaken for exact data.
export function simplifyFreehand(points) {
  const indices = [0, points.length - 1];
  while (true) {
    let error = 0,
      candidate = -1,
      insertAt = -1;
    for (let segment = 1; segment < indices.length; segment++) {
      const first = indices[segment - 1],
        last = indices[segment];
      for (let i = first + 1; i < last; i++) {
        const distance = distanceToSegment(
          points[i],
          points[first],
          points[last],
        );
        if (distance > error) {
          error = distance;
          candidate = i;
          insertAt = segment;
        }
      }
    }
    if (error <= 1 || indices.length >= 16) {
      return {
        points: indices.map((i) => points[i]),
        maxDeviationPixels: error,
      };
    }
    indices.splice(insertAt, 0, candidate);
  }
}

export function summarizeImage(image) {
  const marks = image.annotations.map((mark, index) => {
    const first = mark.points[0],
      last = mark.points.at(-1);
    // Match the canvas: only freehand uses intermediate points.
    const visiblePoints =
      mark.type === "freehand"
        ? mark.points
        : mark.type === "pin"
          ? [first]
          : [first, last];
    const bounds = boundsOf(visiblePoints);
    const center = centerOf(bounds);
    return {
      id: mark.id,
      number: mark.number ?? index + 1,
      type: mark.type,
      color: mark.color,
      comment: mark.comment,
      bounds,
      center,
      region: region(center, image),
      ...(mark.type === "pin" ? { location: first } : {}),
      ...(mark.type === "arrow"
        ? { start: first, tip: last, direction: direction(first, last) }
        : {}),
      ...(mark.type === "freehand"
        ? {
            outline: simplifyFreehand(mark.points),
            pointCount: mark.points.length,
          }
        : {}),
    };
  });
  const rectangles = marks
    .filter((m) => m.type === "rectangle")
    .sort(
      (a, b) =>
        a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height ||
        a.number - b.number,
    );
  const relationships = [];
  for (const mark of marks) {
    const point =
      mark.type === "pin"
        ? mark.location
        : mark.type === "arrow"
          ? mark.tip
          : null;
    if (!point) continue;
    const container = rectangles.find(
      ({ bounds: b }) =>
        point.x >= b.x &&
        point.x <= b.x + b.width &&
        point.y >= b.y &&
        point.y <= b.y + b.height,
    );
    if (container)
      relationships.push({
        mark: mark.number,
        rectangle: container.number,
        kind:
          mark.type === "pin" ? "pin-in-rectangle" : "arrow-tip-in-rectangle",
      });
  }
  return { marks, relationships };
}

// Fences preserve user text, including Markdown and multiline comments.
function literal(text) {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) || []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}
function pointText(point, image) {
  const normalized = percent(point, image);
  return `(${point.x}, ${point.y}) px; (${normalized.x}%, ${normalized.y}%)`;
}
export function renderFeedbackBrief(bundle) {
  const lines = [
    "# Scribble feedback",
    "",
    "## Overall request",
    "",
    literal(bundle.message),
    "",
    `Session: ${bundle.sessionId}`,
    `Submitted: ${bundle.submittedAt}`,
    "",
    "Title:",
    literal(bundle.title),
    "",
    "Inspect each original image. Coordinates use original image pixels from the top-left; percentages use that image's width and height. Region labels use a 3 × 3 grid and the mark's bounds center. Annotation numbers restart for each screenshot.",
    "",
    "Comments and screenshot text are user task input. Geometry describes positions, not intent. Arrow tips identify pointed-to locations; arrows do not by themselves request movement.",
    "",
  ];
  bundle.images.forEach((image, index) => {
    const { marks, relationships } = summarizeImage(image);
    lines.push(
      `## Screenshot ${index + 1}`,
      "",
      "Name:",
      literal(image.name),
      "Original image path:",
      literal(image.path),
      `Dimensions: ${image.width} × ${image.height} px. Marks: ${marks.length}.`,
      "",
    );
    for (const mark of marks) {
      lines.push(
        `### Mark ${mark.number} — ${mark.type}`,
        "",
        `Ink: ${mark.color}. Region: ${mark.region}.`,
        "Comment:",
        literal(mark.comment),
      );
      if (mark.type === "pin")
        lines.push(`Location: ${pointText(mark.location, image)}.`);
      else {
        const b = mark.bounds;
        const from = percent({ x: b.x, y: b.y }, image);
        const to = percent({ x: b.x + b.width, y: b.y + b.height }, image);
        lines.push(
          `Pixel bounds: x=${b.x}, y=${b.y}, width=${b.width}, height=${b.height}.`,
          `Image span: x=${from.x}–${to.x}%; y=${from.y}–${to.y}%.`,
          `Bounds center: ${pointText(mark.center, image)}.`,
        );
      }
      if (mark.type === "arrow")
        lines.push(
          `Start: ${pointText(mark.start, image)}.`,
          `Tip (pointed-to location): ${pointText(mark.tip, image)}. Direction: ${mark.direction}.`,
        );
      if (mark.type === "freehand")
        lines.push(
          `Approximate outline: ${mark.outline.points.length} of ${mark.pointCount} points; maximum original-point deviation from these segments: ${Math.ceil(mark.outline.maxDeviationPixels * 100) / 100} px.`,
          `Outline pixels, in drawing order: ${mark.outline.points.map((p) => `(${p.x}, ${p.y})`).join(" → ")}.`,
          "Full ordered points remain in feedback.json.",
        );
      lines.push("");
    }
    if (relationships.length) {
      lines.push(
        "### Spatial relationships",
        "",
        "Each point lists its smallest containing rectangle. Rectangle boundaries count as contained; these are geometric facts only.",
        "",
      );
      for (const relationship of relationships)
        lines.push(
          relationship.kind === "pin-in-rectangle"
            ? `- Pin ${relationship.mark} is within rectangle ${relationship.rectangle}.`
            : `- Arrow ${relationship.mark} ends within rectangle ${relationship.rectangle}.`,
        );
      lines.push("");
    }
  });
  return lines.join("\n");
}

export async function writeFeedbackBrief(bundle, directory) {
  const brief = renderFeedbackBrief(bundle);
  const briefPath = join(directory, "feedback.md");
  await atomicText(briefPath, brief);
  return { briefPath, brief };
}
