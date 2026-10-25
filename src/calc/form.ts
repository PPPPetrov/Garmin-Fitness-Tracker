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

import type Database from 'better-sqlite3';
import { db } from '../db/index.js';
import { countAtOrBelow, fifthOf, flooredPercentile, lastBeforeRun } from './rank.js';

export const CHANGE_WINDOW_DAYS = 28;
export const CONFIDENCE_WINDOW_DAYS = 90;

/** The fifths of the rider's own form distribution. No absolute number is involved. */
const BANDS: readonly FormBand[] = ['buried', 'tired', 'typical', 'fresh', 'freshest'];

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

/**
 * Where one form value falls among the measured forms, which must be ascending.
 * The rider's own history is the only yardstick: no threshold is involved.
 */
export function placeForm(
  sorted: readonly number[],
  form: number,
): { percentile: number; band: FormBand; rank: number } {
  const percentile = flooredPercentile(sorted, form);
  return {
    percentile,
    band: BANDS[fifthOf(percentile)]!,
    rank: sorted.length - countAtOrBelow(sorted, form) + 1,
  };
}

/** The forms of every measured (non-warm-up) day in the stored series, ascending. */
export function measuredForms(database: Database.Database = db()): number[] {
  return (
    database
      .prepare(`SELECT form FROM daily_load WHERE is_warmup = 0 ORDER BY form`)
      .all() as { form: number }[]
  ).map((row) => row.form);
}

export function formPosition(days: readonly FormDay[]): FormPosition | null {
  const measured = days.filter((d) => !d.isWarmup);
  const today = measured[measured.length - 1];
  if (!today) return null;

  const sorted = measured.map((d) => d.form).sort((a, b) => a - b);
  const n = sorted.length;

  const bandOf = (form: number): FormBand => placeForm(sorted, form).band;

  const placed = placeForm(sorted, today.form);
  const band = placed.band;

  /* A day at exactly zero is carrying no fatigue, so it belongs to the fresh side and
     does not break a run. */
  const positive = today.form >= 0;
  let streak = 0;
  for (let i = measured.length - 1; i >= 0 && measured[i]!.form >= 0 === positive; i--) streak++;

  /* The most recent day before the spell today is in that was also in this band. */
  const lastIndex = lastBeforeRun(measured, (d) => bandOf(d.form) === band);
  const lastInBand = lastIndex >= 0 ? measured[lastIndex]!.date : null;

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
    percentile: placed.percentile,
    rank: placed.rank,
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
