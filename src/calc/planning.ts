/**
 * Form and fitness carried forward to a date, under a load the rider chooses.
 *
 * This is the same arithmetic as the stored series, run past today: the same
 * 7-day and 42-day averages, fed with an assumed load instead of a recorded one. The
 * assumption is a share of the rider's own usual load, in two phases, so every figure here
 * reads "if you rode this much". Nothing is a forecast of what will happen and nothing is a
 * recommendation: no scenario is better than another, and no target form is implied.
 *
 * The projection is never stored, and the stored series is never changed by it. The only
 * thing stored is the plan the rider typed, in the `plan` table, read and written by the
 * thin database half at the bottom of this file.
 */

import type Database from 'better-sqlite3';
import { db } from '../db/index.js';
import { measuredForms, placeForm, type FormBand } from './form.js';
import {
  addDays,
  computeLoadSeries,
  dailyInputs,
  FITNESS_TIME_CONSTANT_DAYS,
  FORMULA_VERSION,
  today as todayLocal,
  type DayInput,
} from './load.js';

/** The shares of the usual load a scenario can assume. */
export const PERCENT_STEPS = [0, 25, 50, 75, 100, 125, 150] as const;
/** The usual load is the average over this many complete days ending yesterday. */
export const USUAL_WINDOW_DAYS = 28;
export const HISTORY_SHOWN_DAYS = 42;
export const MAX_HORIZON_DAYS = 180;
/** With nothing chosen, the default scenario rests from today for this long. */
export const DEFAULT_REST_DAYS = 28;
export const NAME_MAX_LENGTH = 60;

export interface Scenario {
  eventDate: string;
  /** The first day the `afterPct` share applies. Days before it use `beforePct`. */
  switchDate: string;
  beforePct: number;
  afterPct: number;
}

export interface Usual {
  perDay: number;
  perWeek: number;
  rides: number;
  /** Rides in the window whose load is missing or untrustworthy. */
  unmeasured: number;
  from: string;
  to: string;
}

export interface ProjectedDay {
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
  /** True for a day whose load is assumed rather than recorded. */
  projected: boolean;
  estimated: boolean;
}

export interface Projection {
  /** The state carried into today: fitness and fatigue as of yesterday. */
  start: { date: string; fitness: number; fatigue: number; form: number };
  usual: Usual;
  /** HISTORY_SHOWN_DAYS before today, then today up to the event date. */
  series: ProjectedDay[];
  event: {
    date: string;
    form: number;
    fitness: number;
    fitnessChange: number;
    percentile: number;
    band: FormBand;
    rank: number;
    measuredDays: number;
  };
  turnsPositive: string | null;
  peak: { date: string; form: number; fitness: number };
  switchDay: { date: string; form: number; fitness: number };
  /**
   * The first day whose 42-day window is clear of the last unmeasured ride: the projection
   * is less sure until then. It may fall after the event. Null when no projected day is
   * less sure.
   */
  lessSureUntil: string | null;
}

function round(value: number): number {
  /* `+ 0` turns a rounded -0 into 0. */
  return Math.round(value * 100) / 100 + 0;
}

/** The average load over the complete days before today, as far back as the history goes. */
export function usualLoad(
  perDay: ReadonlyMap<string, DayInput>,
  from: string,
  today: string,
): Usual {
  const windowFrom = from > addDays(today, -USUAL_WINDOW_DAYS) ? from : addDays(today, -USUAL_WINDOW_DAYS);
  const to = addDays(today, -1);
  if (windowFrom > to) throw new Error(`No complete day before ${today} to take a usual load from.`);

  let load = 0;
  let rides = 0;
  let unmeasured = 0;
  let days = 0;
  for (let date = windowFrom; date <= to; date = addDays(date, 1)) {
    const entry = perDay.get(date);
    load += entry?.load ?? 0;
    rides += entry?.rides ?? 0;
    unmeasured += entry?.unmeasured ?? 0;
    days++;
  }

  const average = load / days;
  return {
    perDay: round(average),
    perWeek: round(average * 7),
    rides,
    unmeasured,
    from: windowFrom,
    to,
  };
}

/** The load assumed for one day: the before share ahead of the switch date, the after share from it. */
export function scenarioLoad(scenario: Scenario, usualPerDay: number, date: string): number {
  const pct = date < scenario.switchDate ? scenario.beforePct : scenario.afterPct;
  return (pct / 100) * usualPerDay;
}

/** Rest from today, for the length of the default window. */
export function defaultScenario(today: string): Scenario {
  return {
    eventDate: addDays(today, DEFAULT_REST_DAYS),
    switchDate: today,
    beforePct: 0,
    afterPct: 0,
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isStep(pct: number): boolean {
  return (PERCENT_STEPS as readonly number[]).includes(pct);
}

/** One sentence naming the first thing wrong, or null. `name` is checked when given. */
export function scenarioError(
  scenario: Scenario,
  today: string,
  name?: string | null,
): string | null {
  const { eventDate, switchDate, beforePct, afterPct } = scenario;

  if (!isCalendarDate(eventDate)) return 'The event date must be a date, as YYYY-MM-DD.';
  if (!isCalendarDate(switchDate)) return 'The switch date must be a date, as YYYY-MM-DD.';
  if (eventDate <= today) return 'The event date must be after today.';
  if (eventDate > addDays(today, MAX_HORIZON_DAYS)) {
    return `The event date must be within ${MAX_HORIZON_DAYS} days of today.`;
  }
  if (switchDate < today) return 'The switch date must not be before today.';
  if (switchDate > eventDate) return 'The switch date must not be after the event date.';
  if (!isStep(beforePct)) {
    return `The share before the switch must be one of ${PERCENT_STEPS.join(', ')} percent.`;
  }
  if (!isStep(afterPct)) {
    return `The share after the switch must be one of ${PERCENT_STEPS.join(', ')} percent.`;
  }
  if (name != null && name.length > NAME_MAX_LENGTH) {
    return `The name must be at most ${NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * Carry the series forward from today to the event date under the scenario.
 *
 * A day that already has an entry keeps it, so a ride synced today counts as ridden and
 * only the days with nothing recorded take the assumed load. The event day itself is fed
 * nothing: its form is the state going into it, as on every other day.
 *
 * `from` must be before `today`, so that at least one complete day exists.
 */
export function project(
  perDay: ReadonlyMap<string, DayInput>,
  from: string,
  today: string,
  scenario: Scenario,
  sortedForms: readonly number[],
): Projection {
  if (from >= today) throw new Error(`The history must start before ${today} to project from it.`);

  const { eventDate, switchDate } = scenario;
  const usual = usualLoad(perDay, from, today);

  const fed = new Map(perDay);
  for (let date = today; date < eventDate; date = addDays(date, 1)) {
    if (!fed.has(date)) {
      fed.set(date, { load: scenarioLoad(scenario, usual.perDay, date), rides: 0, unmeasured: 0 });
    }
  }

  const rows = computeLoadSeries(fed, from, eventDate);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const row = (date: string) => {
    const found = byDate.get(date);
    if (!found) throw new Error(`No series row for ${date}.`);
    return found;
  };

  const todayRow = row(today);
  const eve = row(addDays(today, -1));
  const start = { date: eve.date, fitness: eve.fitness, fatigue: eve.fatigue, form: todayRow.form };

  const shownFrom = addDays(today, -HISTORY_SHOWN_DAYS) > from ? addDays(today, -HISTORY_SHOWN_DAYS) : from;
  /* The event day's own load is not part of the projection, so its point carries the
     state going into it, as its form does. */
  const eventEve = row(addDays(eventDate, -1));
  const series: ProjectedDay[] = rows
    .filter((r) => r.date >= shownFrom)
    .map((r) => ({
      date: r.date,
      fitness: r.date === eventDate ? eventEve.fitness : r.fitness,
      fatigue: r.date === eventDate ? eventEve.fatigue : r.fatigue,
      form: r.form,
      projected: r.date >= today && !perDay.has(r.date),
      estimated: r.isEstimated,
    }));

  const eventRow = row(eventDate);
  const placed = placeForm(sortedForms, eventRow.form);

  let turnsPositive: string | null = null;
  if (start.form < 0) {
    for (let date = today; date <= eventDate; date = addDays(date, 1)) {
      if (row(date).form >= 0) {
        turnsPositive = date;
        break;
      }
    }
  }

  let peakRow = todayRow;
  for (let date = today; date <= eventDate; date = addDays(date, 1)) {
    if (row(date).form > peakRow.form) peakRow = row(date);
  }

  /* The same boundary as `isEstimated` in computeLoadSeries: a day is less sure while the
     window ending on it holds an unmeasured ride. */
  let lastUnmeasured: string | null = null;
  for (const [date, day] of perDay) {
    if (day.unmeasured > 0 && (lastUnmeasured == null || date > lastUnmeasured)) lastUnmeasured = date;
  }
  const clearFrom = lastUnmeasured == null ? null : addDays(lastUnmeasured, FITNESS_TIME_CONSTANT_DAYS);
  const lessSureUntil = clearFrom != null && clearFrom > today ? clearFrom : null;

  const onTheEve = (date: string) => {
    const day = row(date);
    return { date, form: round(day.form), fitness: row(addDays(date, -1)).fitness };
  };

  return {
    start: {
      date: start.date,
      fitness: round(start.fitness),
      fatigue: round(start.fatigue),
      form: round(start.form),
    },
    usual,
    series,
    event: {
      date: eventDate,
      form: round(eventRow.form),
      fitness: round(eventEve.fitness),
      fitnessChange: round(eventEve.fitness - start.fitness),
      percentile: placed.percentile,
      band: placed.band,
      rank: placed.rank,
      measuredDays: sortedForms.length,
    },
    turnsPositive,
    peak: onTheEve(peakRow.date),
    switchDay: onTheEve(switchDate),
    lessSureUntil,
  };
}

/** What the rider saved: a scenario and an optional name. */
export interface SavedPlan extends Scenario {
  name: string | null;
}

export interface PlanningReport extends Projection {
  /** The saved plan, whether or not it is the one projected. */
  plan: SavedPlan | null;
  scenario: Scenario & { source: 'saved' | 'query' | 'default' };
  /** The saved event date when that date has already gone by, otherwise null. */
  past: string | null;
  formula: string;
}

export function readPlan(database: Database.Database = db()): SavedPlan | null {
  const row = database
    .prepare(`SELECT name, event_date, switch_date, before_pct, after_pct FROM plan WHERE id = 1`)
    .get() as
    | {
        name: string | null;
        event_date: string;
        switch_date: string;
        before_pct: number;
        after_pct: number;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    eventDate: row.event_date,
    switchDate: row.switch_date,
    beforePct: row.before_pct,
    afterPct: row.after_pct,
  };
}

/** Replace the one plan. */
export function savePlan(plan: SavedPlan, database: Database.Database = db()): void {
  database
    .prepare(
      `INSERT INTO plan (id, name, event_date, switch_date, before_pct, after_pct, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, event_date = excluded.event_date,
         switch_date = excluded.switch_date, before_pct = excluded.before_pct,
         after_pct = excluded.after_pct, updated_at = excluded.updated_at`,
    )
    .run(
      plan.name,
      plan.eventDate,
      plan.switchDate,
      plan.beforePct,
      plan.afterPct,
      new Date().toISOString(),
    );
}

export function clearPlan(database: Database.Database = db()): void {
  database.prepare(`DELETE FROM plan WHERE id = 1`).run();
}

/**
 * The projection for a query scenario, else the saved plan if its event is still ahead,
 * else the default. A saved switch date that has gone by is projected, and reported, as
 * today. Null when there is no history, or no complete day to project from.
 * The query is not validated here; the route does that.
 */
export function planningReport(
  query: Scenario | null,
  database: Database.Database = db(),
  today: string = todayLocal(),
): PlanningReport | null {
  const inputs = dailyInputs(database);
  if (!inputs || inputs.from >= today) return null;

  const plan = readPlan(database);
  let scenario: Scenario;
  let source: 'saved' | 'query' | 'default';
  if (query) {
    scenario = query;
    source = 'query';
  } else if (plan && plan.eventDate > today) {
    /* A switch that has gone by is today: every day left already takes the after share,
       so the projection is the same, and the scenario stays one the rider could save. The
       stored row keeps the date as typed. */
    scenario = {
      eventDate: plan.eventDate,
      switchDate: plan.switchDate < today ? today : plan.switchDate,
      beforePct: plan.beforePct,
      afterPct: plan.afterPct,
    };
    source = 'saved';
  } else {
    scenario = defaultScenario(today);
    source = 'default';
  }

  const projection = project(inputs.perDay, inputs.from, today, scenario, measuredForms(database));
  return {
    ...projection,
    plan,
    scenario: { ...scenario, source },
    past: plan && plan.eventDate < today ? plan.eventDate : null,
    formula: FORMULA_VERSION,
  };
}
