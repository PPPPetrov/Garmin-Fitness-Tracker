/**
 * What the body can do, as against how much it has done.
 *
 * Fitness in the load model is accumulated training load: it rises with any month of
 * hard riding, whether or not the rider got stronger. The figures here move only when
 * the rider does — more power for the same heartbeat, more power held for twenty
 * minutes.
 *
 * Efficiency covers road rides only. Power and heart rate sit together in two separate
 * stretches of this history — indoor rides in 2022–23, road rides from October 2025 —
 * and heart rate runs differently indoors, so one trend across both would compare a
 * trainer with a mountain road.
 */

export const EFFICIENCY_TYPE = 'road_biking';
export const EFFICIENCY_MIN_MOVING_S = 1800;
export const EFFICIENCY_MIN_MONTH_RIDES = 3;
export const EFFICIENCY_MIN_SPAN_RIDES = 5;
export const EFFICIENCY_SPAN_MONTHS = 3;

export interface EfficiencyRide {
  date: string;
  type: string;
  normalizedPower: number | null;
  avgHr: number | null;
  movingS: number | null;
}

export interface EfficiencyMonth {
  month: string;
  /** Null when the month has fewer than EFFICIENCY_MIN_MONTH_RIDES: one ride is not a month. */
  median: number | null;
  rides: number;
}

export interface EfficiencyReading {
  /** Complete months only, from the first qualifying ride's month, empty months included. */
  months: EfficiencyMonth[];
  /** The month in progress, kept apart so a few early rides are not drawn as a month. */
  thisMonth: EfficiencyMonth;
  recent: number | null;
  before: number | null;
  change: number | null;
  recentSpan: [string, string];
  beforeSpan: [string, string];
  rides: number;
}

/** `'YYYY-MM'` of an ISO date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** A `'YYYY-MM'` month moved by `n` months. */
export function addMonths(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round3(value: number | null): number | null {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

/**
 * Normalized power per heartbeat on road rides, by month, and the last three complete
 * months against the three before. Every road ride counts, steady or not: the textbook
 * steady-only rule leaves about twenty rides on this terrain, and a noisier monthly
 * median over all of them was the agreed trade.
 */
export function efficiencyReading(rides: readonly EfficiencyRide[], today: string): EfficiencyReading {
  const qualifying = rides
    .filter(
      (r) =>
        r.type === EFFICIENCY_TYPE &&
        r.normalizedPower != null &&
        r.avgHr != null &&
        r.avgHr > 0 &&
        (r.movingS ?? 0) >= EFFICIENCY_MIN_MOVING_S,
    )
    .map((r) => ({ month: monthOf(r.date), ef: r.normalizedPower! / r.avgHr! }));

  const byMonth = new Map<string, number[]>();
  for (const r of qualifying) {
    byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r.ef]);
  }
  const monthEntry = (month: string): EfficiencyMonth => {
    const values = byMonth.get(month) ?? [];
    return {
      month,
      median: values.length >= EFFICIENCY_MIN_MONTH_RIDES ? round3(median(values)) : null,
      rides: values.length,
    };
  };

  const current = monthOf(today);
  const first = [...byMonth.keys()].sort()[0];
  const months: EfficiencyMonth[] = [];
  if (first != null) {
    for (let m = first; m < current; m = addMonths(m, 1)) months.push(monthEntry(m));
  }

  const recentSpan: [string, string] = [addMonths(current, -EFFICIENCY_SPAN_MONTHS), addMonths(current, -1)];
  const beforeSpan: [string, string] = [
    addMonths(current, -2 * EFFICIENCY_SPAN_MONTHS),
    addMonths(current, -EFFICIENCY_SPAN_MONTHS - 1),
  ];
  const inSpan = ([from, to]: [string, string]) =>
    qualifying.filter((r) => r.month >= from && r.month <= to).map((r) => r.ef);
  const recentValues = inSpan(recentSpan);
  const beforeValues = inSpan(beforeSpan);
  const enough =
    recentValues.length >= EFFICIENCY_MIN_SPAN_RIDES && beforeValues.length >= EFFICIENCY_MIN_SPAN_RIDES;
  const recent = enough ? median(recentValues) : null;
  const before = enough ? median(beforeValues) : null;

  return {
    months,
    thisMonth: monthEntry(current),
    recent: round3(recent),
    before: round3(before),
    change: recent != null && before != null ? round3(recent / before - 1) : null,
    recentSpan,
    beforeSpan,
    rides: qualifying.length,
  };
}
