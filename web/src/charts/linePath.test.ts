import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linePath } from './linePath.js';

describe('linePath', () => {
  it('joins neighbouring points and breaks at a gap', () => {
    assert.equal(
      linePath([{ x: 0, y: 10 }, { x: 5, y: 20 }, null, { x: 15, y: 5 }, { x: 20, y: 6 }]),
      'M0.0 10.0L5.0 20.0M15.0 5.0L20.0 6.0',
    );
  });

  /* January 2026 on the efficiency chart: blank months either side. A bare move draws
     nothing, so the month vanished while still stretching the scale. */
  it('draws a point with gaps on both sides as a dot rather than nothing', () => {
    assert.equal(linePath([null, { x: 5, y: 20 }, null]), 'M5.0 20.0l0.01 0');
  });
});
