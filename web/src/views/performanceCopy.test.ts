import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noEstimateReason } from './performanceCopy.js';

describe('noEstimateReason', () => {
  it('says there was no powered ride only when there was none', () => {
    assert.equal(noEstimateReason(0), 'No powered ride in the last 90 days');
  });

  it('says the efforts were too few to fit when rides exist but the fit does not', () => {
    assert.equal(noEstimateReason(3), 'Not enough hard efforts in the last 90 days to fit');
  });
});
