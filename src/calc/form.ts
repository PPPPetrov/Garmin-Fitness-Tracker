/**
 * Where today's form sits in the rider's own history.
 *
 * Form on its own is close to unreadable. A +40 reached by tapering and a +40 reached
 * by not riding for a fortnight are the same number and opposite situations, and the
 * generic cycling thresholds — above +15 fresh, below −10 tired — are somebody else's
 * numbers. Against this history, −10 is an ordinary Tuesday: a quarter of all measured
 * days sit below it.
 *
 * So nothing here is a threshold and nothing here is advice. Every figure says where
 * today stands against the days this rider has actually ridden, and `change` carries
 * fitness over the same window so that a fresh number can be told from a detrained one.
 */

import { db } from '../db/index.js';

export const CHANGE_WINDOW_DAYS = 28;
export const CONFIDENCE_WINDOW_DAYS = 90;

/** The fifths of the rider's own form distribution. No absolute number is involved. */
const BAND_EDGES: readonly { upTo: number; band: FormBand }[] = [
  { upTo: 20, band: 'buried' },
  { upTo: 40, band: 'tired' },
  { upTo: 60, band: 'typical' },
  { upTo: 80, band: 'fresh' },
];

export interface FormDay {
  date: string;
  form: number;
  fitness: number;
  isWarmup: boolean;
  isEstimated: boolean;
}

export type FormBand = 'buried' | 'tired' | 'typical' | 'fresh' | 'freshest';

export interface FormPosition {
  date: string;
  form: number;
  fitness: number;
  /** Share of measured days with a lower form, floored so it never claims all of them. */
  percentile: number;
  /** 1 is the freshest day on record. */
  rank: number;
  /** Days behind the ranking. The warm-up is not among them. */
  measuredDays: number;
  band: FormBand;
  /** Consecutive days ending today on the same side of zero, today included. */
  streak: number;
  /** Form and fitness over the trailing window, with the span actually available. */
  change: { days: number; form: number; fitness: number };
  /** The last day before the current run that was also in this band. */
  lastInBand: string | null;
  /** How much of the recent window rests on an incomplete 42-day fitness window. */
  confidence: { estimated: number; days: number };
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000,
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Number of entries in an ascending array strictly below `value`. */
function countBelow(sorted: readonly number[], value: number): number {
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
function countAtOrBelow(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function formPosition(days: readonly FormDay[]): FormPosition | null {
  const measured = days.filter((d) => !d.isWarmup);
  const today = measured[measured.length - 1];
  if (!today) return null;

  const sorted = measured.map((d) => d.form).sort((a, b) => a - b);
  const n = sorted.length;

  /* Floored on purpose. With four days fresher than today, 99.65% rounds to 100 and
     the sentence then says today beat every day on record, which is false. */
  const percentileOf = (form: number) => Math.floor((100 * countBelow(sorted, form)) / n);
  const bandOf = (form: number): FormBand => {
    const p = percentileOf(form);
    return BAND_EDGES.find((edge) => p < edge.upTo)?.band ?? 'freshest';
  };

  const band = bandOf(today.form);

  /* A day at exactly zero is carrying no fatigue, so it belongs to the fresh side and
     does not break a run. */
  const positive = today.form >= 0;
  let streak = 0;
  for (let i = measured.length - 1; i >= 0 && measured[i]!.form >= 0 === positive; i--) streak++;

  /* The start of the spell today is in — then the most recent day before it that was
     also in this band. Without the skip the answer would always be yesterday. */
  let runStart = measured.length - 1;
  while (runStart > 0 && bandOf(measured[runStart - 1]!.form) === band) runStart--;
  let lastInBand: string | null = null;
  for (let i = runStart - 1; i >= 0; i--) {
    if (bandOf(measured[i]!.form) === band) {
      lastInBand = measured[i]!.date;
      break;
    }
  }

  /* Four weeks back, or the start of the history when it is shorter than that. The
     span is reported rather than assumed, so a young history says what it measured. */
  const wanted = daysBetween(measured[0]!.date, today.date) >= CHANGE_WINDOW_DAYS
    ? measured[measured.length - 1 - CHANGE_WINDOW_DAYS]!
    : measured[0]!;

  const window = measured.slice(-CONFIDENCE_WINDOW_DAYS);

  return {
    date: today.date,
    form: today.form,
    fitness: today.fitness,
    percentile: percentileOf(today.form),
    rank: n - countAtOrBelow(sorted, today.form) + 1,
    measuredDays: n,
    band,
    streak,
    change: {
      days: daysBetween(wanted.date, today.date),
      form: round(today.form - wanted.form),
      fitness: round(today.fitness - wanted.fitness),
    },
    lastInBand,
    confidence: {
      estimated: window.filter((d) => d.isEstimated).length,
      days: window.length,
    },
  };
}

/** Today's position, read from the stored series. */
export function currentFormPosition(): FormPosition | null {
  const rows = db()
    .prepare(
      `SELECT local_date, form, fitness, is_warmup, is_estimated
         FROM daily_load ORDER BY local_date`,
    )
    .all() as {
    local_date: string;
    form: number;
    fitness: number;
    is_warmup: number;
    is_estimated: number;
  }[];

  return formPosition(
    rows.map((row) => ({
      date: row.local_date,
      form: row.form,
      fitness: row.fitness,
      isWarmup: row.is_warmup === 1,
      isEstimated: row.is_estimated === 1,
    })),
  );
}
