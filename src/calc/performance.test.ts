import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/index.js';
import { addDays } from './load.js';
import {
  CP_DURATIONS_S,
  criticalPowerReading,
  efficiencyReading,
  fitCriticalPower,
  median,
  performanceReport,
  rampPosition,
  type CurveEffort,
  type EfficiencyRide,
  type RampDay,
} from './performance.js';

/** A qualifying road ride at the given efficiency: heart rate 100, so NP is EF × 100. */
function ride(date: string, ef: number, overrides: Partial<EfficiencyRide> = {}): EfficiencyRide {
  return {
    date,
    type: 'road_biking',
    normalizedPower: ef * 100,
    avgHr: 100,
    movingS: 3600,
    ...overrides,
  };
}

function rides(month: string, count: number, ef: number): EfficiencyRide[] {
  return Array.from({ length: count }, (_, i) =>
    ride(`${month}-${String(i + 1).padStart(2, '0')}`, ef),
  );
}

describe('efficiencyReading', () => {
  const TODAY = '2026-10-25';

  it('excludes indoor rides, rides without heart rate, and rides under 30 minutes', () => {
    const reading = efficiencyReading(
      [
        ride('2026-09-01', 1.2),
        ride('2026-09-02', 1.2, { type: 'indoor_cycling' }),
        ride('2026-09-03', 1.2, { avgHr: null }),
        ride('2026-09-04', 1.2, { movingS: 1799 }),
      ],
      TODAY,
    );
    assert.equal(reading.rides, 1);
  });

  it('takes the median for odd and even counts', () => {
    assert.equal(median([1.0, 1.4, 1.2]), 1.2);
    // (1.2 + 1.4) / 2 is 1.2999999999999998 in floating point; the readings round, the helper does not.
    assert.ok(Math.abs(median([1.0, 1.2, 1.4, 1.6])! - 1.3) < 1e-9);
    assert.equal(median([]), null);
  });

  it('leaves a month with fewer than 3 rides as null', () => {
    const reading = efficiencyReading([...rides('2026-08', 3, 1.2), ...rides('2026-09', 2, 1.3)], TODAY);
    assert.deepEqual(reading.months, [
      { month: '2026-08', median: 1.2, rides: 3 },
      { month: '2026-09', median: null, rides: 2 },
    ]);
  });

  it('keeps the month in progress out of the series', () => {
    const reading = efficiencyReading([...rides('2026-09', 3, 1.2), ...rides('2026-10', 3, 1.3)], TODAY);
    assert.deepEqual(
      reading.months.map((m) => m.month),
      ['2026-09'],
    );
    assert.deepEqual(reading.thisMonth, { month: '2026-10', median: 1.3, rides: 3 });
  });

  it('includes empty months between rides', () => {
    const reading = efficiencyReading([...rides('2026-06', 3, 1.2), ...rides('2026-08', 3, 1.2)], TODAY);
    assert.deepEqual(reading.months[1], { month: '2026-07', median: null, rides: 0 });
  });

  it('compares the last three complete months with the three before', () => {
    const reading = efficiencyReading([...rides('2026-05', 5, 1.2), ...rides('2026-08', 5, 1.3)], TODAY);
    assert.equal(reading.recent, 1.3);
    assert.equal(reading.before, 1.2);
    assert.equal(reading.change, 0.083);
    assert.deepEqual(reading.recentSpan, ['2026-07', '2026-09']);
    assert.deepEqual(reading.beforeSpan, ['2026-04', '2026-06']);
  });

  it('gives no headline when either side has fewer than 5 rides', () => {
    const reading = efficiencyReading([...rides('2026-05', 4, 1.2), ...rides('2026-08', 5, 1.3)], TODAY);
    assert.equal(reading.recent, null);
    assert.equal(reading.before, null);
    assert.equal(reading.change, null);
  });

  it('crosses the year boundary in January', () => {
    const reading = efficiencyReading([], '2026-01-15');
    assert.deepEqual(reading.recentSpan, ['2025-10', '2025-12']);
    assert.deepEqual(reading.beforeSpan, ['2025-07', '2025-09']);
  });

  it('handles no rides at all', () => {
    const reading = efficiencyReading([], TODAY);
    assert.deepEqual(reading.months, []);
    assert.deepEqual(reading.thisMonth, { month: '2026-10', median: null, rides: 0 });
    assert.equal(reading.rides, 0);
    assert.equal(reading.change, null);
  });
});

/** One ride holding all four durations on a model curve: watts = cp + wPrime / t. */
function modelRide(activityId: number, date: string, cp: number, wPrime: number): CurveEffort[] {
  return CP_DURATIONS_S.map((t) => ({ activityId, date, durationS: t, watts: cp + wPrime / t }));
}

describe('fitCriticalPower', () => {
  it('recovers CP and W′ from bests built on them', () => {
    const fit = fitCriticalPower(CP_DURATIONS_S.map((t) => ({ durationS: t, watts: 250 + 20000 / t })));
    assert.deepEqual(fit, { cp: 250, wPrimeJ: 20000 });
  });

  it('needs three durations', () => {
    assert.equal(
      fitCriticalPower([
        { durationS: 120, watts: 400 },
        { durationS: 1200, watts: 260 },
      ]),
      null,
    );
  });

  it('refuses a fit with no anaerobic capacity', () => {
    assert.equal(fitCriticalPower(CP_DURATIONS_S.map((t) => ({ durationS: t, watts: 200 - 3000 / t }))), null);
  });
});

describe('criticalPowerReading', () => {
  const TODAY = '2026-10-25';

  it('keeps a ride 89 days old and drops one 90 days old', () => {
    const efforts = [
      { activityId: 1, date: addDays(TODAY, -89), durationS: 1200, watts: 250 },
      { activityId: 2, date: addDays(TODAY, -90), durationS: 300, watts: 400 },
    ];
    const { window } = criticalPowerReading(efforts, [], TODAY);
    assert.equal(window.from, addDays(TODAY, -89));
    assert.equal(window.to, TODAY);
    assert.deepEqual(window.bests, [{ durationS: 1200, watts: 250, date: addDays(TODAY, -89) }]);
  });

  it("takes Garmin's FTP on or before the month's end", () => {
    const ftp = [
      { date: '2026-08-10', watts: 230 },
      { date: '2026-09-05', watts: 237 },
    ];
    const { months } = criticalPowerReading(modelRide(1, '2026-07-20', 220, 18000), ftp, TODAY);
    const at = (m: string) => months.find((x) => x.month === m)!;
    assert.equal(at('2026-07').garminFtp, null);
    assert.equal(at('2026-08').garminFtp, 230);
    assert.equal(at('2026-09').garminFtp, 237);
  });

  it('leaves months with too little in the window as null', () => {
    const { months } = criticalPowerReading(modelRide(1, '2024-01-15', 220, 18000), [], '2024-10-25');
    assert.deepEqual(
      months.map((m) => m.month),
      ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10'],
    );
    assert.deepEqual(
      months.map((m) => m.cp),
      [220, 220, 220, null, null, null, null, null, null, null],
    );
    assert.equal(months[0]!.wPrimeJ, 18000);
  });

  it('counts distinct rides in the window', () => {
    const efforts = [
      { activityId: 1, date: '2026-10-01', durationS: 120, watts: 380 },
      { activityId: 1, date: '2026-10-01', durationS: 300, watts: 320 },
      { activityId: 2, date: '2026-10-10', durationS: 1200, watts: 245 },
    ];
    const { months } = criticalPowerReading(efforts, [], TODAY);
    assert.equal(months.at(-1)!.rides, 2);
  });

  it('keeps the earlier ride when two hold the same best', () => {
    const efforts = [
      { activityId: 1, date: '2026-10-01', durationS: 1200, watts: 245 },
      { activityId: 2, date: '2026-10-10', durationS: 1200, watts: 245 },
    ];
    assert.equal(criticalPowerReading(efforts, [], TODAY).window.bests[0]!.date, '2026-10-01');
  });

  it('handles no efforts', () => {
    const reading = criticalPowerReading([], [], TODAY);
    assert.deepEqual(reading.months, []);
    assert.deepEqual(reading.window.bests, []);
  });
});

/** A continuous spine of days from 2024-01-01 carrying the given fitness values. */
function rampSpine(
  fitness: number[],
  options: { warmup?: number; estimated?: number[] } = {},
): RampDay[] {
  const estimated = new Set(options.estimated ?? []);
  return fitness.map((f, i) => ({
    date: addDays('2024-01-01', i),
    fitness: f,
    isWarmup: i < (options.warmup ?? 0),
    isEstimated: estimated.has(i),
  }));
}

/**
 * Fitness built so day i (from 7 on) carries ramp `ramps[i - 7]`: each day is the one a
 * week before plus that day's ramp.
 */
function withRamps(ramps: number[]): number[] {
  const fitness = Array.from({ length: 7 }, () => 50);
  ramps.forEach((r, k) => fitness.push(fitness[k]! + r));
  return fitness;
}

describe('rampPosition', () => {
  it('takes the seven-day difference', () => {
    const position = rampPosition(rampSpine(Array.from({ length: 20 }, (_, i) => 30 + i)))!;
    assert.equal(position.perWeek, 7);
    assert.equal(position.date, '2024-01-20');
  });

  it("skips days whose week-earlier day is warm-up", () => {
    // Indices 0–3 are warm-up, so only 11, 12 and 13 are measured (their d − 7 is 4, 5, 6).
    const fitness = withRamps([9, 9, 9, 9, 1, 2, 3]);
    const position = rampPosition(rampSpine(fitness, { warmup: 4 }))!;
    assert.equal(position.perWeek, 3);
    assert.equal(position.percentile, 66);
  });

  it('floors the percentile and reports the share above', () => {
    // Ramps 1..9, today 4: three below (33%), five above (55%).
    const position = rampPosition(rampSpine(withRamps([1, 2, 3, 5, 6, 7, 8, 9, 4])))!;
    assert.equal(position.percentile, 33);
    assert.equal(position.percentAbove, 55);
    assert.equal(position.band, 'low');
  });

  it('finds the last spell in the same fifth, not yesterday', () => {
    // Lowest spell on days 7–9, a higher spell, then lowest again at the end.
    const ramps = [-5, -5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -5, -5];
    const position = rampPosition(rampSpine(withRamps(ramps)))!;
    assert.equal(position.band, 'lowest');
    assert.equal(position.lastInBand, addDays('2024-01-01', 9));
  });

  it('carries the estimated flag of the latest day', () => {
    const fitness = Array.from({ length: 10 }, (_, i) => i);
    assert.equal(rampPosition(rampSpine(fitness, { estimated: [9] }))!.estimated, true);
    assert.equal(rampPosition(rampSpine(fitness, { estimated: [8] }))!.estimated, false);
  });

  it('returns null on a history no longer than the warm-up plus a week', () => {
    const fitness = Array.from({ length: 45 }, (_, i) => i);
    assert.equal(rampPosition(rampSpine(fitness, { warmup: 42 })), null);
    assert.equal(rampPosition([]), null);
  });
});

describe('performanceReport', () => {
  it('leaves a held-back ride out of critical power and counts it', () => {
    const database = openDatabase(':memory:');
    const addRide = (id: number, date: string, status: string, watts: number) => {
      database
        .prepare(
          `INSERT INTO activity (activity_id, activity_type, start_time_local, local_date, imported_at)
           VALUES (?, 'road_biking', ?, ?, ?)`,
        )
        .run(id, `${date} 09:00:00`, date, date);
      database
        .prepare(`INSERT INTO fit_file (activity_id, status, updated_at) VALUES (?, ?, ?)`)
        .run(id, status, date);
      database
        .prepare(`INSERT INTO power_curve (activity_id, duration_s, watts) VALUES (?, 1200, ?)`)
        .run(id, watts);
    };
    addRide(1, '2026-10-01', 'parsed', 240);
    addRide(2, '2026-10-05', 'pending', 400);

    const report = performanceReport(database, '2026-10-25');

    assert.deepEqual(report.criticalPower.window.bests, [
      { durationS: 1200, watts: 240, date: '2026-10-01' },
    ]);
    assert.equal(report.heldBack, 1);
    assert.equal(report.ramp, null);
    assert.equal(report.efficiency.rides, 0);
  });
});
