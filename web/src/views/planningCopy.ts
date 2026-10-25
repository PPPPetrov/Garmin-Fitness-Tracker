import type { PlanningReport, PlanScenario } from '../api';
import { num, shortDate, signed } from '../format';

/** What a share of the usual load is called: 0 is rest, 100 is the usual, the rest a percentage. */
export function phaseText(pct: number): string {
  if (pct === 0) return 'rest';
  if (pct === 50) return 'ride half your usual';
  if (pct === 100) return 'ride your usual';
  return `ride ${pct}% of your usual`;
}

/** The day before an ISO date, in UTC so a daylight-saving change cannot move it. */
function dayBefore(iso: string): string {
  const date = new Date(iso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The scenario as the start of a sentence. When the before phase is the usual load, or the
 * switch is today so there is no before phase, only the after phase and its date are named.
 */
export function scenarioClause(s: PlanScenario, today: string): string {
  if (s.switchDate === today || s.beforePct === 100) {
    const from = s.switchDate === today ? 'today' : shortDate(s.switchDate);
    return `If you ${phaseText(s.afterPct)} from ${from}`;
  }
  return `If you ${phaseText(s.beforePct)} until ${shortDate(dayBefore(s.switchDate))}, then ${phaseText(s.afterPct)}`;
}

/** Where the event's form sits in the rider's own history, as a caption. */
export function formCaption(e: PlanningReport['event']): string {
  if (e.form >= 0) return `Fresher than ${e.percentile}% of your days`;
  const share = Math.floor((100 * (e.rank - 1)) / e.measuredDays);
  return `More tired than ${share}% of your days`;
}

/**
 * The one sentence the screen leads with. A scenario that ends in rest reports its peak, any
 * other the event day. A saved event that has gone by is said first.
 */
export function planningFinding(r: PlanningReport, today: string): string {
  const clause = scenarioClause(r.scenario, today);
  const prefix = r.past ? `Your event on ${shortDate(r.past)} has passed. ` : '';

  if (r.scenario.afterPct === 0) {
    return (
      `${prefix}${clause}, form peaks at ${signed(r.peak.form, 1)} on ${shortDate(r.peak.date)}, ` +
      `and fitness falls to ${num(r.peak.fitness, 1)} by then.`
    );
  }

  const e = r.event;
  const caption = formCaption(e);
  const standing = caption.charAt(0).toLowerCase() + caption.slice(1);
  const change = Number(e.fitnessChange.toFixed(1));
  const against =
    change < 0
      ? `${num(Math.abs(change), 1)} under yesterday`
      : change > 0
        ? `${num(change, 1)} above yesterday`
        : 'level with yesterday';
  return (
    `${prefix}${clause}, form on ${shortDate(e.date)} is ${signed(e.form, 1)}, ` +
    `${standing}, with fitness ${num(e.fitness, 1)}, ${against}.`
  );
}

/** A share of the usual load as points a week, for the pickers: "50% = 229 a week". */
export function pointsText(pct: number, perWeek: number): string {
  return `${pct}% = ${num((pct / 100) * perWeek, 0)} a week`;
}
