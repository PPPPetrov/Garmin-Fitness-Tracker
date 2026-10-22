import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/index.js';
import {
  addDays,
  computeLoadSeries,
  FATIGUE_TIME_CONSTANT_DAYS,
  FITNESS_TIME_CONSTANT_DAYS,
  UNRELIABLE_LOAD_SQL,
  WARMUP_DAYS,
  type DayInput,
} from './load.js';

const START = '2024-01-01';

function days(entries: Record<string, Partial<DayInput>>): Map<string, DayInput> {
  return new Map(
    Object.entries(entries).map(([date, value]) => [
      date,
      { load: value.load ?? 0, rides: value.rides ?? 1, unmeasured: value.unmeasured ?? 0 },
    ]),
  );
}

function at(series: ReturnType<typeof computeLoadSeries>, date: string) {
  const row = series.find((r) => r.date === date);
  assert.ok(row, `no row for ${date}`);
  return row;
}

describe('computeLoadSeries', () => {
  it('gives every calendar day a row, so a rest day is a zero and not a gap', () => {
    const series = computeLoadSeries(days({ '2024-01-01': { load: 100 } }), START, '2024-01-10');

    assert.equal(series.length, 10);
    assert.deepEqual(
      series.map((r) => r.date),
      Array.from({ length: 10 }, (_, i) => addDays(START, i)),
    );
    assert.equal(at(series, '2024-01-05').load, 0);
    assert.equal(at(series, '2024-01-05').rides, 0);
  });

  it('moves fitness by load/42 and fatigue by load/7 on the first day', () => {
    const series = computeLoadSeries(days({ '2024-01-01': { load: 420 } }), START, START);
    const first = at(series, START);

    assert.equal(first.fitness, 420 / FITNESS_TIME_CONSTANT_DAYS);
    assert.equal(first.fatigue, 420 / FATIGUE_TIME_CONSTANT_DAYS);
  });

  it('reports form as yesterday’s freshness, so day one is always zero', () => {
    const series = computeLoadSeries(
      days({ '2024-01-01': { load: 300 }, '2024-01-02': { load: 300 } }),
      START,
      '2024-01-03',
    );

    // Nothing has happened before the first day, so there is no freshness to report yet.
    assert.equal(at(series, '2024-01-01').form, 0);

    // Day two's form is the state the first day left behind, taken from the running
    // values rather than from the stored two-decimal ones: 300/42 − 300/7.
    assert.equal(at(series, '2024-01-02').form, Math.round((-1500 / 42) * 100) / 100);
  });

  it('carries full precision between days and only rounds what it stores', () => {
    const series = computeLoadSeries(days({ '2024-01-01': { load: 300 } }), START, '2024-01-02');
    const dayOne = at(series, '2024-01-01');
    const dayTwo = at(series, '2024-01-02');

    // Rounding the stored values first would give −35.72; the real difference is −35.71.
    assert.equal(Math.round((dayOne.fitness - dayOne.fatigue) * 100) / 100, -35.72);
    assert.equal(dayTwo.form, -35.71);
  });

  it('decays towards zero through a long rest, without reaching it', () => {
    const series = computeLoadSeries(days({ '2024-01-01': { load: 500 } }), START, '2024-04-01');

    const peak = at(series, '2024-01-01');
    const later = at(series, '2024-02-01');
    const muchLater = at(series, '2024-04-01');

    assert.ok(later.fitness < peak.fitness, 'fitness should fall during rest');
    assert.ok(muchLater.fitness < later.fitness, 'and keep falling');
    assert.ok(muchLater.fitness > 0, 'but an exponential average never reaches zero');

    // Fatigue has the shorter constant, so it empties first.
    assert.ok(later.fatigue < later.fitness);
  });

  it('converges on a steady daily load, fatigue arriving first', () => {
    const steady = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [addDays(START, i), { load: 100 }]),
    );
    const series = computeLoadSeries(days(steady), START, addDays(START, 199));
    const end = series[series.length - 1]!;

    assert.ok(Math.abs(end.fitness - 100) < 1, `fitness ${end.fitness} should approach 100`);
    assert.ok(Math.abs(end.fatigue - 100) < 1, `fatigue ${end.fatigue} should approach 100`);
    assert.ok(Math.abs(end.form) < 1, 'steady training leaves form near neutral');

    // Seven days in, the short constant is already most of the way there and the long one is not.
    const early = at(series, addDays(START, 20));
    assert.ok(early.fatigue > early.fitness, 'fatigue leads fitness while load is ramping');
  });

  it('marks the first 42 days as warm-up and nothing after', () => {
    const series = computeLoadSeries(days({ '2024-01-01': { load: 100 } }), START, '2024-06-01');

    assert.equal(at(series, START).isWarmup, true);
    assert.equal(at(series, addDays(START, WARMUP_DAYS - 1)).isWarmup, true);
    assert.equal(at(series, addDays(START, WARMUP_DAYS)).isWarmup, false);
    assert.equal(series.filter((r) => r.isWarmup).length, WARMUP_DAYS);
  });

  it('shades the 42 days after an unmeasured ride as estimated, then clears', () => {
    const unmeasuredOn = '2024-03-01';
    const series = computeLoadSeries(
      days({ '2024-01-01': { load: 100 }, [unmeasuredOn]: { load: 0, unmeasured: 1 } }),
      START,
      '2024-06-01',
    );

    assert.equal(at(series, unmeasuredOn).isEstimated, true);
    assert.equal(at(series, addDays(unmeasuredOn, 41)).isEstimated, true);
    assert.equal(at(series, addDays(unmeasuredOn, 42)).isEstimated, false);

    // A day well before the bad ride is not retroactively tainted.
    assert.equal(at(series, '2024-02-01').isEstimated, false);
  });

  it('keeps the shade running while unmeasured rides keep arriving', () => {
    const run = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        addDays('2024-03-01', i * 7),
        { load: 0, unmeasured: 1 },
      ]),
    );
    const series = computeLoadSeries(days(run), START, '2024-12-01');
    const lastBadDay = addDays('2024-03-01', 9 * 7);

    assert.equal(
      series.filter((r) => r.date >= '2024-03-01' && r.date <= lastBadDay && !r.isEstimated).length,
      0,
      'overlapping windows should leave no clear day between them',
    );
    assert.equal(at(series, addDays(lastBadDay, 42)).isEstimated, false);
  });

  it('sums several rides on one day into a single load', () => {
    const perDay = new Map<string, DayInput>([
      ['2024-01-01', { load: 240 + 180, rides: 2, unmeasured: 0 }],
    ]);
    const series = computeLoadSeries(perDay, START, START);

    assert.equal(at(series, START).rides, 2);
    assert.equal(at(series, START).load, 420);
  });

  it('returns nothing when the range is inverted', () => {
    assert.deepEqual(computeLoadSeries(new Map(), '2024-02-01', '2024-01-01'), []);
  });
});

describe('UNRELIABLE_LOAD_SQL', () => {
  /**
   * The subtle case: a ride recorded without a heart-rate strap still gets a training
   * load from Garmin, but an EPOC estimate without heart rate comes out roughly eight
   * times too low. It has to be caught alongside an outright NULL.
   */
  const rides = [
    { id: 1, label: 'normal ride with HR and load', hr: 136, load: 105, secs: 4920, bad: false },
    { id: 2, label: 'no load at all', hr: 130, load: null, secs: 3000, bad: true },
    { id: 3, label: 'load but no HR strap', hr: null, load: 22, secs: 5280, bad: true },
    { id: 4, label: 'no HR but under ten minutes', hr: null, load: 3, secs: 420, bad: false },
    { id: 5, label: 'neither HR nor load', hr: null, load: null, secs: 7000, bad: true },
  ];

  it('flags missing load and strapless rides, and spares short ones', () => {
    const database = openDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO activity (activity_id, activity_type, start_time_local, local_date,
                             duration_s, avg_hr, activity_training_load, imported_at)
       VALUES (?, 'road_biking', '2024-01-01 09:00:00', '2024-01-01', ?, ?, ?, '2024-01-01')`,
    );
    for (const ride of rides) insert.run(ride.id, ride.secs, ride.hr, ride.load);

    const flagged = new Set(
      (
        database
          .prepare(`SELECT activity_id FROM activity WHERE ${UNRELIABLE_LOAD_SQL}`)
          .all() as { activity_id: number }[]
      ).map((r) => r.activity_id),
    );

    for (const ride of rides) {
      assert.equal(flagged.has(ride.id), ride.bad, `${ride.label} (#${ride.id})`);
    }
    database.close();
  });
});
