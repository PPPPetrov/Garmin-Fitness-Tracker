import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countAtOrBelow, countBelow, fifthOf, flooredPercentile, lastBeforeRun } from './rank.js';

describe('rank helpers', () => {
  it('counts strictly below and at-or-below separately', () => {
    assert.equal(countBelow([1, 2, 2, 3], 2), 1);
    assert.equal(countAtOrBelow([1, 2, 2, 3], 2), 3);
  });

  it('floors the percentile so it never claims every day', () => {
    assert.equal(flooredPercentile([1, 2, 3], 3), 66);
  });

  it('puts a percentile on an edge into the upper fifth', () => {
    assert.equal(fifthOf(19), 0);
    assert.equal(fifthOf(20), 1);
    assert.equal(fifthOf(80), 4);
  });

  it('skips the current run when looking for the last match', () => {
    // The current run is the last two 'a'; the 'a' before it is at index 1.
    const items = ['a', 'a', 'b', 'b', 'a', 'a'];
    assert.equal(lastBeforeRun(items, (x) => x === 'a'), 1);
    assert.equal(lastBeforeRun(['b', 'a'], (x) => x === 'a'), -1);
  });
});
