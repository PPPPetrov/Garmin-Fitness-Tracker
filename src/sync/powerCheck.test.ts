import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareWithGarmin, describeDisagreement } from './powerCheck.js';

describe('compareWithGarmin', () => {
  it('agrees when every shared duration is within tolerance', () => {
    const ours = new Map([
      [60, 221.6],
      [300, 181.4],
    ]);
    assert.deepEqual(compareWithGarmin(ours, { maxAvgPower_60: 222, maxAvgPower_300: 181 }), []);
  });

  /** Ride #22736415876 as the old parser stored it, against Garmin's own figures. */
  it('reports each duration that disagrees, worst first', () => {
    const ours = new Map([
      [1, 498],
      [60, 476],
      [600, 268.5],
    ]);
    const garmin = { maxAvgPower_1: 498, maxAvgPower_60: 222, maxAvgPower_600: 166 };

    assert.deepEqual(compareWithGarmin(ours, garmin), [
      { duration_s: 60, ours: 476, garmin: 222 },
      { duration_s: 600, ours: 268.5, garmin: 166 },
    ]);
  });

  it('allows two watts on a low figure, where one per cent is less than rounding', () => {
    const ours = new Map([[3600, 101.9]]);
    assert.deepEqual(compareWithGarmin(ours, { maxAvgPower_3600: 100 }), []);
  });

  it('skips durations Garmin does not report, rather than counting them as agreeing or not', () => {
    // Garmin has no 15 s figure, and none at all for an hour on a ride shorter than one.
    const ours = new Map([
      [15, 900],
      [3600, 150],
    ]);
    assert.deepEqual(compareWithGarmin(ours, { maxAvgPower_3600: null }), []);
  });
});

describe('describeDisagreement', () => {
  it('names the duration and both figures', () => {
    assert.equal(
      describeDisagreement({ duration_s: 60, ours: 476, garmin: 222 }),
      'Disagrees with Garmin at 60 s: 476 W from the file against 222 W',
    );
  });
});
