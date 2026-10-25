import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlanningReport } from '../api';
import {
  formCaption,
  planningFinding,
  phaseText,
  pointsText,
  scenarioClause,
} from './planningCopy.js';

const TODAY = '2026-10-25';

function report(over: Partial<PlanningReport>): PlanningReport {
  return {
    past: null,
    scenario: {
      eventDate: '2026-11-29',
      switchDate: '2026-11-19',
      beforePct: 100,
      afterPct: 50,
      source: 'query',
    },
    event: {
      date: '2026-11-29',
      form: 23.28,
      fitness: 62.99,
      fitnessChange: -13.01,
      percentile: 91,
      band: 'freshest',
      rank: 90,
      measuredDays: 1000,
    },
    peak: { date: '2026-11-06', form: 47.66, fitness: 56.92 },
    ...over,
  } as PlanningReport;
}

const rest: PlanningReport['scenario'] = {
  eventDate: '2026-11-22',
  switchDate: TODAY,
  beforePct: 0,
  afterPct: 0,
  source: 'default',
};

describe('phaseText', () => {
  it('names rest, half, the usual, and any other share', () => {
    assert.equal(phaseText(0), 'rest');
    assert.equal(phaseText(50), 'ride half your usual');
    assert.equal(phaseText(100), 'ride your usual');
    assert.equal(phaseText(75), 'ride 75% of your usual');
  });
});

describe('pointsText', () => {
  it('rounds the points to a whole number', () => {
    assert.equal(pointsText(50, 458.28), '50% = 229 a week');
  });
});

describe('scenarioClause', () => {
  it('says rest from today when the switch is today', () => {
    assert.equal(scenarioClause(rest, TODAY), 'If you rest from today');
  });

  it('names only the after phase when the before phase is the usual load', () => {
    assert.equal(
      scenarioClause(report({}).scenario, TODAY),
      'If you ride half your usual from 19 Nov',
    );
  });

  it('names both phases otherwise, ending the first the day before the switch', () => {
    const s = { ...rest, switchDate: '2026-11-01', beforePct: 50, afterPct: 0 };
    assert.equal(scenarioClause(s, TODAY), 'If you ride half your usual until 31 Oct, then rest');
  });
});

describe('scenarioClause / one phase', () => {
  it('names only the before phase when the switch is the event day', () => {
    const s = { ...rest, eventDate: '2026-11-29', switchDate: '2026-11-29', beforePct: 50, afterPct: 0 };
    assert.equal(scenarioClause(s, TODAY), 'If you ride half your usual until 28 Nov');
  });

  it('names the before phase until the eve even when it is the usual load', () => {
    const s = { ...rest, eventDate: '2026-11-29', switchDate: '2026-11-29', beforePct: 100, afterPct: 25 };
    assert.equal(scenarioClause(s, TODAY), 'If you ride your usual until 28 Nov');
  });

  it('says the phase once, from today, when both shares are the same', () => {
    const s = { ...rest, switchDate: '2026-11-01', beforePct: 50, afterPct: 50 };
    assert.equal(scenarioClause(s, TODAY), 'If you ride half your usual from today');
  });

  it('says rest from today when both shares are rest', () => {
    const s = { ...rest, switchDate: '2026-11-01' };
    assert.equal(scenarioClause(s, TODAY), 'If you rest from today');
  });
});

describe('planningFinding', () => {
  it('reports the event for a taper', () => {
    assert.equal(
      planningFinding(report({}), TODAY),
      'If you ride half your usual from 19 Nov, form on 29 Nov is +23.3, fresher than 91% of your days, with fitness 63.0, 13.0 under yesterday.',
    );
  });

  it('says above yesterday when fitness rises', () => {
    const r = report({});
    r.event.fitnessChange = 2.04;
    assert.match(planningFinding(r, TODAY), /with fitness 63\.0, 2\.0 above yesterday\.$/);
  });

  it('says level with yesterday when the change is zero at one decimal', () => {
    const r = report({});
    r.event.fitnessChange = 0.04;
    assert.match(planningFinding(r, TODAY), /with fitness 63\.0, level with yesterday\.$/);
  });

  it('reports the peak for a rest scenario', () => {
    assert.equal(
      planningFinding(report({ scenario: rest }), TODAY),
      'If you rest from today, form peaks at +47.7 on 6 Nov, and fitness falls to 56.9 by then.',
    );
  });

  it('reports the event when the switch is the event day, though the after share is rest', () => {
    const scenario = { ...rest, eventDate: '2026-11-29', switchDate: '2026-11-29', beforePct: 50, afterPct: 0 };
    assert.equal(
      planningFinding(report({ scenario }), TODAY),
      'If you ride half your usual until 28 Nov, form on 29 Nov is +23.3, fresher than 91% of your days, with fitness 63.0, 13.0 under yesterday.',
    );
  });

  it('reports the peak when both shares are rest and the switch is later', () => {
    const scenario = { ...rest, switchDate: '2026-11-01' };
    assert.equal(
      planningFinding(report({ scenario }), TODAY),
      'If you rest from today, form peaks at +47.7 on 6 Nov, and fitness falls to 56.9 by then.',
    );
  });

  it('opens with the passed event when there is one', () => {
    assert.ok(
      planningFinding(report({ scenario: rest, past: '2026-10-20' }), TODAY).startsWith(
        'Your event on 20 Oct has passed. If you rest from today',
      ),
    );
  });
});

describe('formCaption', () => {
  it('says fresher when form is not negative', () => {
    assert.equal(formCaption(report({}).event), 'Fresher than 91% of your days');
  });

  it('says more tired by rank when form is negative', () => {
    const e = { ...report({}).event, form: -5, rank: 801, measuredDays: 1000 };
    assert.equal(formCaption(e), 'More tired than 80% of your days');
  });
});
