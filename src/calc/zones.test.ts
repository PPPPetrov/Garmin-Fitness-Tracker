import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ZONE_COUNT, zoneTotals, type ZoneRide } from './zones.js';

function ride(durationS: number | null, zones: (number | null)[]): ZoneRide {
  return { durationS, zones };
}

describe('zoneTotals', () => {
  it('sums each zone across the rides offered', () => {
    const totals = zoneTotals([
      ride(1000, [100, 200, 300, 40, 10]),
      ride(1000, [50, 100, 150, 20, 5]),
    ]);

    assert.deepEqual(totals.seconds, [150, 300, 450, 60, 15]);
    assert.equal(totals.zoneSeconds, 975);
    assert.equal(totals.rides, 2);
  });

  it('leaves out a ride missing a bucket rather than reading the gap as zero', () => {
    // A strapless ride has no zones at all. Counting it as five zeros would say the
    // rider spent that time in Z1, which is exactly the lie the load model avoids.
    const totals = zoneTotals([
      ride(1000, [100, 200, 300, 40, 10]),
      ride(3600, [null, null, null, null, null]),
      ride(1800, [10, 20, null, 5, 1]),
    ]);

    assert.deepEqual(totals.seconds, [100, 200, 300, 40, 10]);
    assert.equal(totals.rides, 1, 'only the complete ride counts');
    assert.equal(totals.ridesTotal, 3, 'but all three were offered');
  });

  it('measures coverage against only the rides that had zones', () => {
    // 650 zone seconds over the 1000-second ride that carried them. The 3600-second
    // ride without zones must not drag the ratio down; it is not evidence of anything.
    const totals = zoneTotals([
      ride(1000, [100, 200, 300, 40, 10]),
      ride(3600, [null, null, null, null, null]),
    ]);

    assert.equal(totals.coverage, 0.65);
  });

  it('reports no coverage when no ride carried zones, rather than zero', () => {
    const totals = zoneTotals([ride(3600, [null, null, null, null, null])]);

    assert.equal(totals.coverage, null);
    assert.equal(totals.zoneSeconds, 0);
    assert.deepEqual(totals.seconds, new Array(ZONE_COUNT).fill(0));
  });

  it('reports no coverage when the rides that had zones had no duration', () => {
    const totals = zoneTotals([ride(null, [100, 200, 300, 40, 10])]);

    assert.equal(totals.coverage, null, 'a ratio needs a denominator');
    assert.equal(totals.zoneSeconds, 650, 'but the seconds are still real');
  });

  it('returns an empty set for no rides at all', () => {
    const totals = zoneTotals([]);

    assert.equal(totals.rides, 0);
    assert.equal(totals.ridesTotal, 0);
    assert.equal(totals.coverage, null);
    assert.deepEqual(totals.seconds, new Array(ZONE_COUNT).fill(0));
  });
});
