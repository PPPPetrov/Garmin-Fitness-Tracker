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
