import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { efficiencyEmptyText, noEstimateReason, noFindingText } from './performanceCopy.js';

describe('noEstimateReason', () => {
  it('says there was no powered ride only when there was none', () => {
    assert.equal(noEstimateReason(0), 'No powered ride in the last 90 days');
  });

  it('says the efforts were too few to fit when rides exist but the fit does not', () => {
    assert.equal(noEstimateReason(3), 'Not enough hard efforts in the last 90 days to fit');
  });
});

describe('efficiencyEmptyText', () => {
  it('says there are no rides when there are none', () => {
    assert.equal(
      efficiencyEmptyText({ month: '2026-10', median: null, rides: 0 }),
      'No road ride with power and heart rate yet.',
    );
  });

  it('points at the month in progress when its rides are the only ones', () => {
    assert.equal(
      efficiencyEmptyText({ month: '2026-10', median: 1.301, rides: 3 }),
      'No complete month yet. Oct so far: 1.30 from 3 rides.',
    );
  });
});

describe('noFindingText', () => {
  it('says there are no powered rides only for a history without any', () => {
    assert.equal(noFindingText(false), 'No powered rides yet, so there is nothing to measure here.');
  });

  it('says nothing is current when powered rides exist but are old', () => {
    assert.equal(
      noFindingText(true),
      'No powered ride in the last 90 days, so there is nothing current to measure.',
    );
  });
});
