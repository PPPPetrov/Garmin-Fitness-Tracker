/**
 * Heart-rate time in zone, summed over a set of rides.
 *
 * Garmin reports five buckets per ride in the activity list response. They are the only
 * measure in this project that says what *kind* of riding was done rather than how much,
 * and they reach the mountain biking, which is 58% of the riding and has no power meter.
 *
 * Two things the arithmetic has to be careful about, both of them the same instinct that
 * governs the load model: a gap is not a zero, and a ratio needs an honest denominator.
 */

import { addDays } from './load.js';
import { db } from '../db/index.js';

export const ZONE_COUNT = 5;

export interface ZoneRide {
  durationS: number | null;
  /** The five buckets, in seconds. A ride without a strap carries none of them. */
  zones: (number | null)[];
}

export interface ZoneTotals {
  /** Seconds in each zone, summed over the rides that carried all five. */
  seconds: number[];
  zoneSeconds: number;
  /** Rides that carried all five buckets. */
  rides: number;
  /** Rides offered, whether they carried them or not. */
  ridesTotal: number;
  /**
   * Zone seconds over the duration of the rides that carried zones — about 0.80 across
   * this history, because paused and strapless time falls into no bucket. It is why the
   * shares are drawn as a share of recorded time and never as a share of the ride.
   */
  coverage: number | null;
}

export function zoneTotals(rides: readonly ZoneRide[]): ZoneTotals {
  const seconds: number[] = new Array(ZONE_COUNT).fill(0);
  let counted = 0;
  let durationWithZones = 0;

  for (const ride of rides) {
    /* All five or none. A ride with a partial set is a ride we do not understand, and
       reading its missing buckets as zero would claim the rider spent that time in Z1. */
    if (ride.zones.length !== ZONE_COUNT || ride.zones.some((z) => z == null)) continue;

    counted++;
    for (let i = 0; i < ZONE_COUNT; i++) seconds[i]! += ride.zones[i]!;
    if (ride.durationS != null) durationWithZones += ride.durationS;
  }

  const zoneSeconds = seconds.reduce((a, b) => a + b, 0);

  return {
    seconds,
    zoneSeconds,
    rides: counted,
    ridesTotal: rides.length,
    /* Measured against the rides that carried zones, never against every ride offered:
       a strapless ride is not evidence that the zones are incomplete. */
    coverage:
      durationWithZones > 0 ? Math.round((zoneSeconds / durationWithZones) * 100) / 100 : null,
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000,
  );
}

function totalsForRange(from: string, to: string): ZoneTotals {
  const rows = db()
    .prepare(
      `SELECT duration_s, hr_zone_1_s, hr_zone_2_s, hr_zone_3_s, hr_zone_4_s, hr_zone_5_s
         FROM activity WHERE local_date BETWEEN ? AND ?`,
    )
    .all(from, to) as {
    duration_s: number | null;
    hr_zone_1_s: number | null;
    hr_zone_2_s: number | null;
    hr_zone_3_s: number | null;
    hr_zone_4_s: number | null;
    hr_zone_5_s: number | null;
  }[];

  return zoneTotals(
    rows.map((row) => ({
      durationS: row.duration_s,
      zones: [row.hr_zone_1_s, row.hr_zone_2_s, row.hr_zone_3_s, row.hr_zone_4_s, row.hr_zone_5_s],
    })),
  );
}

export interface ZoneReading {
  period: ZoneTotals & { from: string; to: string };
  /** The span of equal length immediately before it, so the two are comparable. */
  previous: ZoneTotals & { from: string; to: string };
}

/**
 * The period and the one before it. A share on its own says what the riding looked like;
 * it takes the previous span of the same length to say whether that has changed, which is
 * the same comparison the season table makes.
 */
export function zonesInRange(from: string, to: string): ZoneReading {
  const span = Math.max(1, daysBetween(from, to) + 1);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(span - 1));

  return {
    period: { ...totalsForRange(from, to), from, to },
    previous: { ...totalsForRange(previousFrom, previousTo), from: previousFrom, to: previousTo },
  };
}
