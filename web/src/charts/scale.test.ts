import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { niceScale } from './scale.js';

describe('niceScale', () => {
  it('keeps round steps with the top tick above the maximum', () => {
    assert.deepEqual(niceScale(0, 237), { lo: 0, hi: 300, ticks: [0, 100, 200, 300] });
  });

  /* One month of efficiency, drawn without zero: min equals max. The old fallback was a
     0–1 scale, which put a 1.29 above the plot. */
  it('pads a single value so it sits inside the scale', () => {
    const { lo, hi } = niceScale(1.29, 1.29);
    assert.ok(lo < 1.29 && 1.29 < hi, `${lo}–${hi} should hold 1.29`);
  });

  it('still reads an all-zero series from zero', () => {
    assert.deepEqual(niceScale(0, 0), { lo: 0, hi: 1, ticks: [0, 1] });
  });
});
