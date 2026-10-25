import type Database from 'better-sqlite3';
import { db } from '../db/index.js';

/**
 * Bump this whenever the maths below changes, so stored rows can be told apart
 * from rows computed by an earlier version.
 */
export const FORMULA_VERSION = 'ewma-atl7-ctl42-v1';

export const FITNESS_TIME_CONSTANT_DAYS = 42;
export const FATIGUE_TIME_CONSTANT_DAYS = 7;

/** The curve is not meaningful until it has had a fitness time constant to settle. */
export const WARMUP_DAYS = FITNESS_TIME_CONSTANT_DAYS;

/**
 * A ride whose training load cannot be trusted.
 *
 * Two cases, and the second is the dangerous one:
 *
 *  - Garmin gave no load at all (NULL). Easy to spot.
 *  - The ride was recorded without a heart-rate strap. Garmin still reports a load,
 *    but `activityTrainingLoad` is EPOC-derived, so without heart rate it comes out
 *    about eight times too low: across this history, rides with heart rate average
 *    67 load points per hour and rides without average 8. The road ride of
 *    19 Oct 2026 scored TSS 91 — harder, by power, than the 8 Oct ride's 77 — yet
 *    was given a load of 22 against that ride's 105, purely because the strap was off.
 *
 * A NULL announces itself. A plausible-looking wrong number does not, so both are
 * counted here and the days they fall on are marked.
 */
export const UNRELIABLE_LOAD_SQL = `(activity_training_load IS NULL
   OR (avg_hr IS NULL AND COALESCE(duration_s, 0) > 600))`;

export interface DailyLoadRow {
  local_date: string;
  load_points: number;
  ride_count: number;
  fitness: number;
  fatigue: number;
  form: number;
  is_warmup: number;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What one calendar day contributes to the curve. */
export interface DayInput {
  load: number;
  rides: number;
  /** Rides whose load is missing or untrustworthy. See UNRELIABLE_LOAD_SQL. */
  unmeasured: number;
}

export interface SeriesRow {
  date: string;
  load: number;
  rides: number;
  unmeasured: number;
  fitness: number;
  fatigue: number;
  form: number;
  isWarmup: boolean;
  isEstimated: boolean;
}

/**
 * The fitness / fatigue / form series, as pure arithmetic over a continuous date spine.
 *
 *   load(d)    = sum of activity_training_load on day d, 0 on a rest day
 *   fitness(d) = fitness(d-1) + (load(d) - fitness(d-1)) / 42
 *   fatigue(d) = fatigue(d-1) + (load(d) - fatigue(d-1)) / 7
 *   form(d)    = fitness(d-1) - fatigue(d-1)
 *
 * The input is Garmin's `activityTrainingLoad`, not TSS. Training load is derived from
 * heart rate and EPOC and is present on most rides; TSS needs a power meter and is
 * missing from roughly two thirds of this history. Mixing them would put a step change
 * in the curve wherever the bike changed.
 *
 * Every day between `from` and `to` gets a row, so a rest day is a genuine zero input
 * rather than a missing point. A day whose rides have no usable load is a different
 * thing again: it is counted in `unmeasured` and shades the next 42 days as estimated.
 */
export function computeLoadSeries(
  perDay: ReadonlyMap<string, DayInput>,
  from: string,
  to: string,
): SeriesRow[] {
  const series: SeriesRow[] = [];
  let fitness = 0;
  let fatigue = 0;
  // The last day a ride happened whose load we cannot trust. Every fitness value for
  // the next 42 days is built on a window with a hole in it.
  let lastUnmeasured: string | null = null;

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const entry = perDay.get(date);
    const load = entry?.load ?? 0;
    const unmeasured = entry?.unmeasured ?? 0;
    if (unmeasured > 0) lastUnmeasured = date;

    // form is yesterday's state: how fresh you are going into today.
    const form = fitness - fatigue;

    fitness += (load - fitness) / FITNESS_TIME_CONSTANT_DAYS;
    fatigue += (load - fatigue) / FATIGUE_TIME_CONSTANT_DAYS;

    series.push({
      date,
      load,
      rides: entry?.rides ?? 0,
      unmeasured,
      fitness: Math.round(fitness * 100) / 100,
      fatigue: Math.round(fatigue * 100) / 100,
      form: Math.round(form * 100) / 100,
      isWarmup: date < addDays(from, WARMUP_DAYS),
      isEstimated:
        lastUnmeasured !== null && date < addDays(lastUnmeasured, FITNESS_TIME_CONSTANT_DAYS),
    });
  }

  return series;
}

/** Recompute the stored series from the activity table. */
export function recomputeDailyLoad(): { days: number; from: string; to: string } | null {
  const database = db();

  const bounds = database
    .prepare(`SELECT MIN(local_date) AS lo FROM activity`)
    .get() as { lo: string | null };
  if (!bounds.lo) return null;

  const from = bounds.lo;
  const to = today();

  const perDay = new Map<string, { load: number; rides: number; unmeasured: number }>();
  const rows = database
    .prepare(
      `SELECT local_date,
              SUM(COALESCE(activity_training_load, 0)) AS load_points,
              COUNT(*) AS ride_count,
              SUM(CASE WHEN ${UNRELIABLE_LOAD_SQL} THEN 1 ELSE 0 END) AS unmeasured
         FROM activity
        GROUP BY local_date`,
    )
    .all() as {
    local_date: string;
    load_points: number;
    ride_count: number;
    unmeasured: number;
  }[];
  for (const row of rows) {
    perDay.set(row.local_date, {
      load: row.load_points,
      rides: row.ride_count,
      unmeasured: row.unmeasured,
    });
  }

  const computedAt = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO daily_load (local_date, load_points, ride_count, fitness, fatigue, form,
                             is_warmup, unmeasured_rides, is_estimated, formula_version, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET
       load_points = excluded.load_points, ride_count = excluded.ride_count,
       fitness = excluded.fitness, fatigue = excluded.fatigue, form = excluded.form,
       is_warmup = excluded.is_warmup, unmeasured_rides = excluded.unmeasured_rides,
       is_estimated = excluded.is_estimated, formula_version = excluded.formula_version,
       computed_at = excluded.computed_at`,
  );

  const series = computeLoadSeries(perDay, from, to);

  database.transaction(() => {
    for (const row of series) {
      insert.run(
        row.date,
        row.load,
        row.rides,
        row.fitness,
        row.fatigue,
        row.form,
        row.isWarmup ? 1 : 0,
        row.unmeasured,
        row.isEstimated ? 1 : 0,
        FORMULA_VERSION,
        computedAt,
      );
    }
  })();

  return { days: series.length, from, to };
}

/** How much of the history each metric actually covers. */
export function loadCoverage(): {
  total: number;
  withLoad: number;
  withTss: number;
  unreliableLoad: number;
} {
  return db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN activity_training_load IS NOT NULL THEN 1 ELSE 0 END) AS withLoad,
              SUM(CASE WHEN training_stress_score IS NOT NULL THEN 1 ELSE 0 END) AS withTss,
              SUM(CASE WHEN ${UNRELIABLE_LOAD_SQL} THEN 1 ELSE 0 END) AS unreliableLoad
         FROM activity`,
    )
    .get() as { total: number; withLoad: number; withTss: number; unreliableLoad: number };
}

/**
 * The best power recorded at each duration, with the ride it came from.
 *
 * Both bounds are optional, and a season is compared with the same span of the season
 * before it: a peak held over ten months against one held over twelve is not a
 * comparison, it is a longer dice roll.
 *
 * Only rides whose file is `parsed` count. One the Garmin cross-check flagged is back
 * to `pending`, and a record it holds would be a parser fault, not an effort.
 */
export function bestPowerCurve(
  sinceDate?: string,
  untilDate?: string,
): {
  duration_s: number;
  watts: number;
  activity_id: number;
  local_date: string;
}[] {
  const since = sinceDate ?? null;
  const until = untilDate ?? null;
  return db()
    .prepare(
      `SELECT p.duration_s, p.watts, p.activity_id, a.local_date
         FROM power_curve p
         JOIN activity a ON a.activity_id = p.activity_id
         JOIN fit_file f ON f.activity_id = p.activity_id AND f.status = 'parsed'
        WHERE (? IS NULL OR a.local_date >= ?)
          AND (? IS NULL OR a.local_date <= ?)
          AND p.watts = (
            SELECT MAX(p2.watts) FROM power_curve p2
            JOIN activity a2 ON a2.activity_id = p2.activity_id
            JOIN fit_file f2 ON f2.activity_id = p2.activity_id AND f2.status = 'parsed'
            WHERE p2.duration_s = p.duration_s
              AND (? IS NULL OR a2.local_date >= ?)
              AND (? IS NULL OR a2.local_date <= ?)
          )
        GROUP BY p.duration_s
        ORDER BY p.duration_s`,
    )
    .all(since, since, until, until, since, since, until, until) as {
    duration_s: number;
    watts: number;
    activity_id: number;
    local_date: string;
  }[];
}

/** Rides in the range that have a power curve on file but are left out of the records. */
export function powerCurveHeldBack(
  sinceDate?: string,
  untilDate?: string,
  database: Database.Database = db(),
): number {
  const since = sinceDate ?? null;
  const until = untilDate ?? null;
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n
         FROM fit_file f
         JOIN activity a ON a.activity_id = f.activity_id
        WHERE f.status <> 'parsed'
          AND EXISTS (SELECT 1 FROM power_curve p WHERE p.activity_id = f.activity_id)
          AND (? IS NULL OR a.local_date >= ?)
          AND (? IS NULL OR a.local_date <= ?)`,
    )
    .get(since, since, until, until) as { n: number };
  return row.n;
}
