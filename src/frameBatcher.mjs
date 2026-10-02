/** Coalesce preview updates while keeping the gesture's full point history separate.
 * @template T
 * @param {(value: T) => void} commit
 * @param {(callback: FrameRequestCallback) => number} requestFrame
 * @param {(id: number) => void} cancelFrame
 */
export function frameBatcher(
  commit,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
) {
  /** @type {number | null} */
  let frame = null;
  /** @type {(() => void) | null} */
  let latest = null;
  return {
    /** @param {T} value */
    schedule(value) {
      latest = () => commit(value);
      if (frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        const update = latest;
        latest = null;
        update?.();
      });
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      latest = null;
    },
  };
}
