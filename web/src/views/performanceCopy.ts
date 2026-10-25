import type { EfficiencyMonth } from '../api';
import { DASH, monthYear } from '../format';

/**
 * Why there is no critical power for now. A window can hold powered rides and still give no
 * fit — no twenty-minute effort, or bests that do not fall the way all-out ones do — and
 * telling that rider they have no powered rides would be false.
 */
export function noEstimateReason(ridesInWindow: number): string {
  return ridesInWindow > 0
    ? 'Not enough hard efforts in the last 90 days to fit'
    : 'No powered ride in the last 90 days';
}

/** Why the efficiency chart is empty: no rides at all, or only the month in progress so far. */
export function efficiencyEmptyText(thisMonth: EfficiencyMonth): string {
  if (thisMonth.rides === 0) return 'No road ride with power and heart rate yet.';
  const month = monthYear(`${thisMonth.month}-01`).split(' ')[0];
  const median = thisMonth.median == null ? DASH : thisMonth.median.toFixed(2);
  const rides = thisMonth.rides === 1 ? 'ride' : 'rides';
  return `No complete month yet. ${month} so far: ${median} from ${thisMonth.rides} ${rides}.`;
}

/**
 * The finding when no rule has anything to say. "No powered rides yet" is only true of a
 * history with none at all; a rider whose powered rides are all old has nothing current.
 */
export function noFindingText(anyPoweredRide: boolean): string {
  return anyPoweredRide
    ? 'No powered ride in the last 90 days, so there is nothing current to measure.'
    : 'No powered rides yet, so there is nothing to measure here.';
}
