import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/index.js';
import { addDays } from './load.js';
import {
  CHANGE_WINDOW_DAYS,
  CONFIDENCE_WINDOW_DAYS,
  formPosition,
  measuredForms,
  placeForm,
  type FormDay,
} from './form.js';

const START = '2024-01-01';

/**
 * A continuous spine of days carrying the given form values, oldest first. Fitness
 * defaults to a flat 50 so a test that says nothing about fitness is not also
 * saying something about it.
 */
function spine(
  forms: number[],
  options: { from?: string; warmup?: number; fitness?: number[]; estimated?: string[] } = {},
): FormDay[] {
  const from = options.from ?? START;
  const warmup = options.warmup ?? 0;
  const estimated = new Set(options.estimated ?? []);
  return forms.map((form, i) => ({
    date: addDays(from, i),
    form,
    fitness: options.fitness?.[i] ?? 50,
    isWarmup: i < warmup,
    isEstimated: estimated.has(addDays(from, i)),
  }));
}

describe('formPosition', () => {
  it('ranks today against the measured history and leaves the warm-up out of it', () => {
    // Forms 1..10, but the first four days are warm-up and do not count as history.
    const days = spine([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { warmup: 4 });

    const position = formPosition(days)!;

    assert.equal(position.measuredDays, 6, 'six measured days, not ten');
    assert.equal(position.rank, 1, 'today is the freshest of them');
    // Five of the six measured days sit below today: 5/6 = 83%.
    assert.equal(position.percentile, 83);
  });

  it('never claims to be fresher than every day, because today is one of them', () => {
    const days = spine([10, 20, 30]);

    const position = formPosition(days)!;

    assert.equal(position.rank, 1);
    assert.ok(position.percentile < 100, `${position.percentile} would overclaim`);
  });

  it('counts the days that are genuinely fresher, so a near-best day is not called best', () => {
    // Today is 39.9 with four days above it, exactly the shape of the real history.
    const days = spine([47.1, 43.8, 41.0, 40.5, 10, 0, -5, 39.9]);

    const position = formPosition(days)!;

    assert.equal(position.rank, 5, 'four days were fresher');
    assert.equal(position.measuredDays, 8);
  });

  it('counts the run of days ending today on the same side of zero', () => {
    const days = spine([-20, -12, 0.8, 11.7, 20.8, 28.4]);

    assert.equal(formPosition(days)!.streak, 4, 'positive since the 0.8');
  });

  it('counts a run below zero the same way', () => {
    const days = spine([5, 10, -3, -8, -26.9, -36.5]);

    assert.equal(formPosition(days)!.streak, 4);
  });

  it('puts a form of exactly zero on the positive side, so the run does not break on it', () => {
    const days = spine([-5, 0, 3, 8]);

    assert.equal(formPosition(days)!.streak, 3);
  });

  it('reports the change in form and fitness over the same window, so a fresh number can be read', () => {
    // Form climbs 40 points while fitness falls 6: freshness bought by not riding.
    const forms = Array.from({ length: CHANGE_WINDOW_DAYS + 1 }, (_, i) => i * (40 / CHANGE_WINDOW_DAYS));
    const fitness = Array.from({ length: CHANGE_WINDOW_DAYS + 1 }, (_, i) => 80 - i * (6 / CHANGE_WINDOW_DAYS));
    const days = spine(forms, { fitness });

    const position = formPosition(days)!;

    assert.equal(position.change.days, CHANGE_WINDOW_DAYS);
    assert.equal(Math.round(position.change.form), 40);
    assert.equal(Math.round(position.change.fitness), -6);
  });

  it('measures the change over what history there is when it is shorter than the window', () => {
    const days = spine([10, 20, 30], { fitness: [40, 45, 50] });

    const position = formPosition(days)!;

    assert.equal(position.change.days, 2, 'two days is all there is');
    assert.equal(position.change.form, 20);
    assert.equal(position.change.fitness, 10);
  });

  it('finds the last time form was this high, skipping the run it is in', () => {
    // A fresh spell, a hard month, then fresh again. The answer is the earlier spell's
    // last day, not yesterday.
    const days = spine(
      [10, 90, 95, 12, -40, -45, -50, -42, 8, 91, 96],
      { from: '2024-01-01' },
    );

    const position = formPosition(days)!;

    assert.equal(position.lastInBand, '2024-01-03', 'the last day of the earlier spell');
  });

  it('reports no previous time when today is the first day in its band', () => {
    const days = spine([-50, -40, -30, -20, 90]);

    assert.equal(formPosition(days)!.lastInBand, null);
  });

  it('bands by the rider’s own distribution rather than by fixed thresholds', () => {
    // Form 1..100. The same absolute number lands in a different band depending on
    // the history around it, which is the entire point.
    const high = formPosition(spine(Array.from({ length: 100 }, (_, i) => i + 1)))!;
    assert.equal(high.band, 'freshest');

    // Now 100 is an ordinary day among much fresher ones.
    const ordinary = formPosition(
      spine([...Array.from({ length: 99 }, (_, i) => 101 + i), 100]),
    )!;
    assert.equal(ordinary.band, 'buried');
  });

  it('counts how many recent days lean on an incomplete window', () => {
    const forms = Array.from({ length: CONFIDENCE_WINDOW_DAYS }, () => 10);
    const estimated = Array.from({ length: 53 }, (_, i) => addDays(START, i));
    const days = spine(forms, { estimated });

    const position = formPosition(days)!;

    assert.equal(position.confidence.days, CONFIDENCE_WINDOW_DAYS);
    assert.equal(position.confidence.estimated, 53);
  });

  it('returns nothing when the history is all warm-up, because there is no position to report', () => {
    assert.equal(formPosition(spine([1, 2, 3], { warmup: 3 })), null);
  });

  it('returns nothing when there are no days at all', () => {
    assert.equal(formPosition([]), null);
  });
});

describe('placeForm', () => {
  it('gives the percentile, band and rank of one value in an ascending history', () => {
    assert.deepEqual(placeForm([-20, -10, 0, 10, 20], 10), {
      percentile: 60,
      band: 'fresh',
      rank: 2,
    });
  });
});

describe('measuredForms', () => {
  it('lists the forms of the measured days in ascending order and leaves the warm-up out', () => {
    const database = openDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO daily_load (local_date, load_points, ride_count, fitness, fatigue, form,
                               is_warmup, formula_version, computed_at)
       VALUES (?, 0, 0, 0, 0, ?, ?, 'test', '2024-01-01')`,
    );
    // Stored out of order, with two warm-up rows carrying the extremes.
    const rows: [number, number, number][] = [
      [0, -50, 1],
      [1, 12, 0],
      [2, -3, 0],
      [3, 99, 1],
      [4, 5, 0],
    ];
    for (const [i, form, warmup] of rows) insert.run(addDays(START, i), form, warmup);

    assert.deepEqual(measuredForms(database), [-3, 5, 12]);
    database.close();
  });
});
