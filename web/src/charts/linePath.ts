/**
 * An SVG path through the given points, broken wherever a point is missing rather than
 * interpolated across the gap.
 *
 * A point with gaps on both sides is drawn as a zero-length stroke, which the round line
 * cap renders as a dot. A bare move would draw nothing, and the value would vanish while
 * still stretching the scale.
 */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  let d = '';
  points.forEach((p, i) => {
    if (p == null) return;
    const joined = points[i - 1] != null;
    d += `${joined ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    if (!joined && points[i + 1] == null) d += 'l0.01 0';
  });
  return d;
}
