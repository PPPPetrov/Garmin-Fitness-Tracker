/**
 * Placing one day against every day the rider has measured.
 *
 * Form and ramp rate are both read the same way: not against a generic threshold, which
 * belongs to somebody else's history, but as a rank in this rider's own distribution.
 * The arithmetic lives here so the two cannot drift apart.
 */

/** Number of entries in an ascending array strictly below `value`. */
export function countBelow(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of entries in an ascending array at or below `value`. */
export function countAtOrBelow(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Share of entries below `value`, as a whole percentage. Floored on purpose: with four
 * days above today, 99.65% rounds to 100 and the sentence then says today beat every
 * day on record, which is false.
 */
export function flooredPercentile(sorted: readonly number[], value: number): number {
  return Math.floor((100 * countBelow(sorted, value)) / sorted.length);
}

/** Which fifth of the distribution a percentile falls in; an edge belongs to the upper one. */
export function fifthOf(percentile: number): 0 | 1 | 2 | 3 | 4 {
  if (percentile < 20) return 0;
  if (percentile < 40) return 1;
  if (percentile < 60) return 2;
  if (percentile < 80) return 3;
  return 4;
}

/**
 * The index of the last item before the current trailing run that also matches, or −1.
 * The run is skipped first: without it the answer would always be yesterday.
 */
export function lastBeforeRun<T>(items: readonly T[], sameAsLast: (item: T) => boolean): number {
  let runStart = items.length - 1;
  while (runStart > 0 && sameAsLast(items[runStart - 1]!)) runStart--;
  for (let i = runStart - 1; i >= 0; i--) {
    if (sameAsLast(items[i]!)) return i;
  }
  return -1;
}
