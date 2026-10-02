/** @type {WeakMap<Array<{x: number, y: number}>, string>} */
const paths = new WeakMap();
/** Points are immutable once published to a saved annotation or preview.
 * @param {Array<{x: number, y: number}>} points
 */
export function annotationPath(points) {
  let path = paths.get(points);
  if (path === undefined) {
    path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    paths.set(points, path);
  }
  return path;
}
