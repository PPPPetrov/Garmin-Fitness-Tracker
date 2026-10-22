import { db } from '../db/index.js';

/**
 * Garmin's activity list carries its own peak power for each ride as
 * `maxAvgPower_{seconds}`: 1 s to 5 min on every powered ride, and 10 min to an hour
 * on every ride long enough to hold one. Eleven of our thirteen durations have a
 * Garmin figure beside them, so every parsed ride can be checked without a request.
 */
const TOLERANCE = 0.01;
/** Garmin reports whole watts, and one per cent of a low figure is less than rounding. */
const TOLERANCE_FLOOR_W = 2;

export interface Disagreement {
  duration_s: number;
  ours: number;
  garmin: number;
}

/** Every shared duration where our figure and Garmin's differ, worst first. */
export function compareWithGarmin(
  ours: Map<number, number>,
  listJson: Record<string, unknown>,
): Disagreement[] {
  const out: Disagreement[] = [];
  for (const [duration, watts] of ours) {
    const garmin = listJson[`maxAvgPower_${duration}`];
    if (typeof garmin !== 'number') continue;
    if (Math.abs(watts - garmin) > Math.max(TOLERANCE_FLOOR_W, TOLERANCE * garmin)) {
      out.push({ duration_s: duration, ours: watts, garmin });
    }
  }
  const off = (d: Disagreement) => Math.abs(d.ours - d.garmin) / Math.max(d.garmin, 1);
  return out.sort((a, b) => off(b) - off(a));
}

export function describeDisagreement(d: Disagreement): string {
  return `Disagrees with Garmin at ${d.duration_s} s: ${d.ours} W from the file against ${d.garmin} W`;
}

export interface PowerCheckResult {
  checked: number;
  agreed: number;
  /** Rides with no Garmin figure at any of our durations. */
  unverifiable: number;
  flagged: { activity_id: number; local_date: string; reason: string }[];
}

/**
 * Check every stored power curve against Garmin's figures.
 *
 * A ride that disagrees is set back to `pending`: the records leave it out, and the
 * next FIT sync parses it again. One that agrees is `parsed`, which is what lets it
 * into the records. No network.
 */
export function verifyPowerCurves(): PowerCheckResult {
  const database = db();
  const rides = database
    .prepare(
      `SELECT f.activity_id, a.local_date, r.list_json
         FROM fit_file f
         JOIN activity a ON a.activity_id = f.activity_id
         LEFT JOIN activity_raw r ON r.activity_id = f.activity_id
        WHERE f.status IN ('parsed','pending')
          AND EXISTS (SELECT 1 FROM power_curve p WHERE p.activity_id = f.activity_id)
        ORDER BY a.local_date`,
    )
    .all() as { activity_id: number; local_date: string; list_json: string | null }[];

  const curveOf = database.prepare(
    'SELECT duration_s, watts FROM power_curve WHERE activity_id = ?',
  );
  const setStatus = database.prepare(
    `UPDATE fit_file SET status = ?, error = ?, updated_at = ? WHERE activity_id = ?`,
  );

  const result: PowerCheckResult = { checked: 0, agreed: 0, unverifiable: 0, flagged: [] };
  const now = new Date().toISOString();

  database.transaction(() => {
    for (const ride of rides) {
      const listJson = ride.list_json ? (JSON.parse(ride.list_json) as Record<string, unknown>) : {};
      const curve = new Map(
        (curveOf.all(ride.activity_id) as { duration_s: number; watts: number }[]).map((p) => [
          p.duration_s,
          p.watts,
        ]),
      );
      const shared = [...curve.keys()].filter(
        (d) => typeof listJson[`maxAvgPower_${d}`] === 'number',
      );

      result.checked++;
      if (shared.length === 0) {
        // Nothing to check against is not evidence against the file.
        result.unverifiable++;
        setStatus.run('parsed', null, now, ride.activity_id);
        continue;
      }

      const worst = compareWithGarmin(curve, listJson)[0];
      if (worst) {
        const reason = describeDisagreement(worst);
        result.flagged.push({ activity_id: ride.activity_id, local_date: ride.local_date, reason });
        setStatus.run('pending', reason, now, ride.activity_id);
      } else {
        result.agreed++;
        setStatus.run('parsed', null, now, ride.activity_id);
      }
    }
  })();

  return result;
}
