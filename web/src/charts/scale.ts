/**
 * Round, even steps with the top tick above the maximum.
 *
 * A single value — one month of efficiency, drawn without zero — has no span to divide, so
 * it is padded by a tenth either side to sit inside the plot. An all-zero series keeps a
 * 0–1 scale so it still reads from zero.
 */
export function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min === 0 && max === 0)) {
    return { lo: 0, hi: 1, ticks: [0, 1] };
  }
  if (min === max) {
    const pad = Math.abs(min) * 0.1;
    return niceScale(min - pad, max + pad);
  }
  const span = max - min;
  const rawStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil((max + step * 0.01) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}
