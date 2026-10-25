import type { PlanScenario } from '../api';

/** The named shapes a scenario can take. Custom is any other, set by hand. */
export type Preset = 'rest' | 'usual' | 'taper' | 'custom';

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'rest', label: 'Rest' },
  { id: 'usual', label: 'Usual' },
  { id: 'taper', label: 'Taper' },
  { id: 'custom', label: 'Custom' },
];

/** How long the taper runs, and at what share. */
export const TAPER_DAYS = 7;
export const TAPER_PCT = 50;

/** The shares a custom phase offers. A saved share outside them is offered too, so it shows. */
export const LEVELS = [0, 50, 100, 125];

/** The phases of a scenario without the event date. */
type Phases = Pick<PlanScenario, 'switchDate' | 'beforePct' | 'afterPct'>;

/** An ISO date moved by whole days, in UTC so a daylight-saving change cannot move it. */
function shift(iso: string, days: number): string {
  const date = new Date(iso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another. */
function between(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}

/** How many days before the event the switch is: the length of the after phase. */
export function lastDays(s: Pick<PlanScenario, 'eventDate' | 'switchDate'>): number {
  return between(s.switchDate, s.eventDate);
}

/** The switch date that leaves `days` days before the event, kept between today and the event. */
export function switchFor(eventDate: string, days: number, today: string): string {
  const date = shift(eventDate, -Math.max(0, Math.round(days)));
  return date < today ? today : date;
}

/** The phases a preset stands for, for an event on `eventDate`. Not defined for custom. */
export function presetPhases(preset: Exclude<Preset, 'custom'>, eventDate: string, today: string): Phases {
  if (preset === 'rest') return { switchDate: today, beforePct: 0, afterPct: 0 };
  if (preset === 'usual') return { switchDate: today, beforePct: 100, afterPct: 100 };
  return { switchDate: switchFor(eventDate, TAPER_DAYS, today), beforePct: 100, afterPct: TAPER_PCT };
}

/**
 * The preset a scenario is, judged by the shares its days actually take: a phase with no day
 * in it does not count, so 0% before a switch on today is rest whatever the before share says.
 */
export function presetOf(s: PlanScenario, today: string): Preset {
  const shares = new Set<number>();
  if (s.switchDate > today) shares.add(s.beforePct);
  if (s.switchDate < s.eventDate) shares.add(s.afterPct);
  const only = shares.size === 1 ? [...shares][0] : undefined;
  if (only === 0) return 'rest';
  if (only === 100) return 'usual';
  const taper = presetPhases('taper', s.eventDate, today);
  if (
    s.switchDate === taper.switchDate &&
    s.afterPct === taper.afterPct &&
    (s.beforePct === taper.beforePct || s.switchDate === today)
  ) {
    return 'taper';
  }
  return 'custom';
}

/**
 * The scenario after the event date moves. A preset keeps its shape against the new date;
 * a custom scenario keeps its last-days count.
 */
export function moveEvent(s: PlanScenario, preset: Preset, eventDate: string, today: string): PlanScenario {
  if (preset !== 'custom') return { eventDate, ...presetPhases(preset, eventDate, today) };
  return { ...s, eventDate, switchDate: switchFor(eventDate, lastDays(s), today) };
}

/** The shares a phase picker offers: the levels, and the current share if it is not one. */
export function levelsWith(pct: number): number[] {
  return LEVELS.includes(pct) ? LEVELS : [...LEVELS, pct].sort((a, b) => a - b);
}
