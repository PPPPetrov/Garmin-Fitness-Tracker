import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  lastDays,
  levelsWith,
  moveEvent,
  presetOf,
  presetPhases,
  switchFor,
} from './planningScenario.js';

const TODAY = '2026-10-25';
const EVENT = '2026-11-29';

describe('switchFor / lastDays', () => {
  it('puts the switch the given days before the event, and reads them back', () => {
    assert.equal(switchFor(EVENT, 7, TODAY), '2026-11-22');
    assert.equal(lastDays({ eventDate: EVENT, switchDate: '2026-11-22' }), 7);
  });

  it('puts the switch on the event day for no last days', () => {
    assert.equal(switchFor(EVENT, 0, TODAY), EVENT);
  });

  it('keeps the switch from going before today', () => {
    assert.equal(switchFor('2026-10-28', 7, TODAY), TODAY);
  });
});

describe('presetPhases', () => {
  it('rests and rides the usual from today', () => {
    assert.deepEqual(presetPhases('rest', EVENT, TODAY), { switchDate: TODAY, beforePct: 0, afterPct: 0 });
    assert.deepEqual(presetPhases('usual', EVENT, TODAY), { switchDate: TODAY, beforePct: 100, afterPct: 100 });
  });

  it('tapers to half for the last seven days', () => {
    assert.deepEqual(presetPhases('taper', EVENT, TODAY), {
      switchDate: '2026-11-22',
      beforePct: 100,
      afterPct: 50,
    });
  });
});

describe('presetOf', () => {
  it('reads each preset back', () => {
    for (const preset of ['rest', 'usual', 'taper'] as const) {
      assert.equal(presetOf({ eventDate: EVENT, ...presetPhases(preset, EVENT, TODAY) }, TODAY), preset);
    }
  });

  it('judges by the phases that hold a day', () => {
    assert.equal(presetOf({ eventDate: EVENT, switchDate: TODAY, beforePct: 125, afterPct: 0 }, TODAY), 'rest');
    assert.equal(presetOf({ eventDate: EVENT, switchDate: EVENT, beforePct: 100, afterPct: 0 }, TODAY), 'usual');
    assert.equal(presetOf({ eventDate: EVENT, switchDate: '2026-11-01', beforePct: 0, afterPct: 0 }, TODAY), 'rest');
  });

  it('reads a taper whose event is less than seven days away', () => {
    const near = '2026-10-28';
    assert.equal(presetOf({ eventDate: near, ...presetPhases('taper', near, TODAY) }, TODAY), 'taper');
  });

  it('calls anything else custom', () => {
    assert.equal(presetOf({ eventDate: EVENT, switchDate: '2026-11-19', beforePct: 100, afterPct: 50 }, TODAY), 'custom');
    assert.equal(presetOf({ eventDate: EVENT, switchDate: '2026-11-22', beforePct: 125, afterPct: 50 }, TODAY), 'custom');
    assert.equal(presetOf({ eventDate: EVENT, switchDate: TODAY, beforePct: 0, afterPct: 75 }, TODAY), 'custom');
  });
});

describe('moveEvent', () => {
  it('keeps a preset against the new date', () => {
    const taper = { eventDate: EVENT, ...presetPhases('taper', EVENT, TODAY) };
    assert.deepEqual(moveEvent(taper, 'taper', '2026-12-06', TODAY), {
      eventDate: '2026-12-06',
      switchDate: '2026-11-29',
      beforePct: 100,
      afterPct: 50,
    });
  });

  it('keeps the last-days count of a custom scenario', () => {
    const custom = { eventDate: EVENT, switchDate: '2026-11-19', beforePct: 125, afterPct: 50 };
    assert.deepEqual(moveEvent(custom, 'custom', '2026-12-06', TODAY), { ...custom, eventDate: '2026-12-06', switchDate: '2026-11-26' });
  });
});

describe('levelsWith', () => {
  it('offers the levels, and a share outside them in its place', () => {
    assert.deepEqual(levelsWith(50), [0, 50, 100, 125]);
    assert.deepEqual(levelsWith(75), [0, 50, 75, 100, 125]);
  });
});
