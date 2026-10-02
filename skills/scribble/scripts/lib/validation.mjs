import { draftBytes, MAX_DRAFT_BYTES, DRAFT_TOO_LARGE } from "./limits.mjs";
const types = new Set(["pin", "arrow", "rectangle", "freehand"]);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { status: 400 });
}
export function validateDraft(body, session) {
  check(body && typeof body === "object", "Expected a feedback draft.");
  check(
    body.revision === session.revision,
    "This session changed in another tab. Reload to get the latest draft.",
  );
  check(
    typeof body.message === "string" && body.message.length <= 20000,
    "Keep the overall message under 20,000 characters.",
  );
  check(
    Array.isArray(body.images) && body.images.length <= 30,
    "A session can have up to 30 screenshots.",
  );
  const imageIds = new Set();
  const markIds = new Set();
  const draft = {
    message: body.message,
    images: body.images.map((image) => {
      const original = session.images.find((i) => i.id === image.id);
      check(
        original && !imageIds.has(image.id),
        "Screenshot not found or duplicated.",
      );
      imageIds.add(image.id);
      check(
        Array.isArray(image.annotations) && image.annotations.length <= 500,
        "A screenshot can have up to 500 marks.",
      );
      return {
        ...original,
        annotations: image.annotations.map((mark) => {
          check(
            mark &&
              typeof mark.id === "string" &&
              /^[\w-]{1,80}$/.test(mark.id) &&
              !markIds.has(mark.id),
            "Invalid or duplicate mark.",
          );
          markIds.add(mark.id);
          check(types.has(mark.type), "Unknown drawing tool.");
          check(
            typeof mark.color === "string" && /^#[\da-f]{6}$/i.test(mark.color),
            "Invalid ink color.",
          );
          check(
            typeof mark.comment === "string" && mark.comment.length <= 10000,
            "Keep each comment under 10,000 characters.",
          );
          check(
            Array.isArray(mark.points) &&
              mark.points.length >= (mark.type === "pin" ? 1 : 2) &&
              mark.points.length <= 5000,
            "Invalid drawing points.",
          );
          check(
            mark.points.every(
              (p) =>
                p &&
                finite(p.x) &&
                finite(p.y) &&
                p.x >= 0 &&
                p.y >= 0 &&
                p.x <= original.width &&
                p.y <= original.height,
            ),
            "Mark is outside the screenshot.",
          );
          return {
            id: mark.id,
            type: mark.type,
            color: mark.color,
            comment: mark.comment,
            points: mark.points.map((p) => ({ x: p.x, y: p.y })),
          };
        }),
      };
    }),
  };
  check(draftBytes(draft) <= MAX_DRAFT_BYTES, DRAFT_TOO_LARGE);
  return draft;
}
export function imageKind(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { extension: "png", mime: "image/png" };
  if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return { extension: "jpg", mime: "image/jpeg" };
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return { extension: "webp", mime: "image/webp" };
  throw Object.assign(new Error("Choose a PNG, JPEG, or WebP image."), {
    status: 400,
  });
}
