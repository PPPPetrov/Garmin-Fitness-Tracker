import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeForm } from './form.js';
import { openDatabase } from '../db/index.js';
import { addDays, computeLoadSeries, dailyInputs, type DayInput } from './load.js';
import {
  clearPlan,
  defaultScenario,
  planningReport,
  project,
  readPlan,
  savePlan,
  scenarioError,
  scenarioLoad,
  usualLoad,
  type Scenario,
} from './planning.js';

const TODAY = '2026-10-25';

/** A perDay map from `date → load`, one measured ride per day. */
function history(days: Record<string, number>): Map<string, DayInput> {
  return new Map(
    Object.entries(days).map(([date, load]) => [date, { load, rides: 1, unmeasured: 0 }]),
  );
}

/** The same load on every day from `from` to `to`, inclusive. */
function steady(from: string, to: string, load: number): Record<string, number> {
  const days: Record<string, number> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) days[d] = load;
  return days;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    eventDate: addDays(TODAY, 30),
    switchDate: TODAY,
    beforePct: 100,
    afterPct: 100,
    ...overrides,
  };
}

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe('project / history', () => {
  const from = addDays(TODAY, -100);
  const perDay = history({
    ...steady(from, addDays(TODAY, -1), 40),
    [addDays(TODAY, -5)]: 90,
  });

  it('leaves the rows before today as the stored series computes them', () => {
    const projection = project(perDay, from, TODAY, scenario(), []);
    const stored = computeLoadSeries(perDay, from, addDays(TODAY, -1));
    const shown = projection.series.filter((d) => d.date < TODAY);
    assert.equal(shown.length, 42);
    for (const day of shown) {
      const row = stored.find((r) => r.date === day.date)!;
      assert.equal(day.fitness, row.fitness);
      assert.equal(day.fatigue, row.fatigue);
      assert.equal(day.form, row.form);
      assert.equal(day.projected, false);
    }
  });

  it('does not mutate the input map', () => {
    const before = new Map(perDay);
    project(perDay, from, TODAY, scenario(), []);
    assert.deepEqual(perDay, before);
  });
});

describe('project / rest', () => {
  it('decays fitness by 41/42 and fatigue by 6/7 a day', () => {
    const from = addDays(TODAY, -100);
    const perDay = history(steady(from, addDays(TODAY, -1), 60));
    const projection = project(perDay, from, TODAY, scenario({ beforePct: 0, afterPct: 0 }), []);
    let prev: { fitness: number; fatigue: number } = projection.start;
    /* The event day carries the state of its eve, so it is not a step of its own. */
    for (const day of projection.series.filter((d) => d.date >= TODAY && d.date < projection.event.date)) {
      near(day.fitness, (prev.fitness * 41) / 42, 0.01);
      near(day.fatigue, (prev.fatigue * 6) / 7, 0.01);
      prev = day;
    }
  });
});

describe('project / steady', () => {
  it('holds fitness and fatigue at the load when it is ridden as usual', () => {
    const from = addDays(TODAY, -400);
    const perDay = history(steady(from, addDays(TODAY, -1), 50));
    const projection = project(perDay, from, TODAY, scenario(), []);
    for (const day of projection.series.filter((d) => d.date >= TODAY)) {
      near(day.fitness, 50, 0.05);
      near(day.fatigue, 50, 0.05);
    }
  });
});

describe('project / event day', () => {
  const from = addDays(TODAY, -100);
  const base = steady(from, addDays(TODAY, -1), 45);
  const s = scenario({ afterPct: 50 });

  it('takes form and fitness from the eve', () => {
    const projection = project(history(base), from, TODAY, s, []);
    const eve = projection.series.find((d) => d.date === addDays(s.eventDate, -1))!;
    assert.equal(projection.event.date, s.eventDate);
    near(projection.event.form, eve.fitness - eve.fatigue, 0.011);
    assert.equal(projection.event.fitness, eve.fitness);
    near(projection.event.fitnessChange, eve.fitness - projection.start.fitness, 0.011);
  });

  it('is unchanged by a load on the event date itself', () => {
    const plain = project(history(base), from, TODAY, s, []);
    const loaded = project(history({ ...base, [s.eventDate]: 300 }), from, TODAY, s, []);
    assert.deepEqual(loaded.event, plain.event);
  });
});

describe('project / switch', () => {
  it('feeds the before share until the switch date and the after share from it', () => {
    const from = addDays(TODAY, -200);
    const perDay = history({
      ...steady(from, addDays(TODAY, -29), 20),
      ...steady(addDays(TODAY, -28), addDays(TODAY, -1), 60),
    });
    const switchDate = addDays(TODAY, 3);
    const projection = project(
      perDay,
      from,
      TODAY,
      scenario({ beforePct: 100, afterPct: 0, switchDate }),
      [],
    );
    const at = (n: number) => projection.series.find((d) => d.date === addDays(TODAY, n))!;

    assert.equal(projection.usual.perDay, 60);
    near(at(2).fitness - at(1).fitness, (60 - at(1).fitness) / 42, 0.02);
    near(at(3).fitness - at(2).fitness, (0 - at(2).fitness) / 42, 0.02);
  });

  it('gives no projected day the before share when the switch is today', () => {
    const rest = scenario({ switchDate: TODAY, beforePct: 150, afterPct: 0 });
    assert.equal(scenarioLoad(rest, 60, TODAY), 0);
    assert.equal(scenarioLoad({ ...rest, switchDate: addDays(TODAY, 1) }, 60, TODAY), 90);

    const from = addDays(TODAY, -100);
    const perDay = history(steady(from, addDays(TODAY, -1), 60));
    const projection = project(perDay, from, TODAY, rest, []);
    const todayRow = projection.series.find((d) => d.date === TODAY)!;
    near(todayRow.fitness, (projection.start.fitness * 41) / 42, 0.01);
  });
});

describe('project / synced today', () => {
  it('keeps a ride already on today and projects from tomorrow', () => {
    const from = addDays(TODAY, -100);
    const perDay = history({ ...steady(from, addDays(TODAY, -1), 40), [TODAY]: 120 });
    const projection = project(perDay, from, TODAY, scenario({ beforePct: 0, afterPct: 0 }), []);
    const todayRow = projection.series.find((d) => d.date === TODAY)!;
    const tomorrow = projection.series.find((d) => d.date === addDays(TODAY, 1))!;
    near(todayRow.fitness - projection.start.fitness, (120 - projection.start.fitness) / 42, 0.02);
    assert.equal(todayRow.projected, false);
    assert.equal(tomorrow.projected, true);
  });
});

describe('usualLoad', () => {
  it('averages the 28 days before today and leaves today out', () => {
    const from = addDays(TODAY, -100);
    const perDay = history({ [addDays(TODAY, -1)]: 70, [TODAY]: 1000 });
    const usual = usualLoad(perDay, from, TODAY);
    assert.equal(usual.perDay, 2.5);
    assert.equal(usual.perWeek, 17.5);
    assert.equal(usual.from, addDays(TODAY, -28));
    assert.equal(usual.to, addDays(TODAY, -1));
    assert.equal(usual.rides, 1);
  });

  it('sums the unmeasured rides over the window', () => {
    const perDay = new Map<string, DayInput>([
      [addDays(TODAY, -3), { load: 10, rides: 2, unmeasured: 1 }],
      [addDays(TODAY, -10), { load: 10, rides: 1, unmeasured: 1 }],
      [addDays(TODAY, -40), { load: 10, rides: 1, unmeasured: 1 }],
    ]);
    const usual = usualLoad(perDay, addDays(TODAY, -100), TODAY);
    assert.equal(usual.unmeasured, 2);
    assert.equal(usual.rides, 3);
  });

  it('divides by the days there are when the history is short', () => {
    const from = addDays(TODAY, -10);
    const usual = usualLoad(history(steady(from, addDays(TODAY, -1), 30)), from, TODAY);
    assert.equal(usual.perDay, 30);
    assert.equal(usual.from, from);
    assert.equal(usual.to, addDays(TODAY, -1));
    const sparse = usualLoad(history({ [addDays(TODAY, -1)]: 100 }), from, TODAY);
    assert.equal(sparse.perDay, 10);
  });
});

describe('project / turnsPositive', () => {
  const tiredFrom = addDays(TODAY, -60);
  const tired = history(steady(tiredFrom, addDays(TODAY, -1), 100));

  it('is null when the form carried into today is not negative', () => {
    const from = addDays(TODAY, -120);
    const rested = history(steady(from, addDays(TODAY, -11), 100));
    const projection = project(rested, from, TODAY, scenario({ beforePct: 0, afterPct: 0 }), []);
    assert.ok(projection.start.form >= 0);
    assert.equal(projection.turnsPositive, null);
  });

  it('names the day a tired state crosses zero under rest', () => {
    const projection = project(tired, tiredFrom, TODAY, scenario({ beforePct: 0, afterPct: 0 }), []);
    assert.ok(projection.start.form < 0);
    const date = projection.turnsPositive!;
    assert.ok(date > TODAY);
    const row = projection.series.find((d) => d.date === date)!;
    const before = projection.series.find((d) => d.date === addDays(date, -1))!;
    assert.ok(row.form >= 0);
    assert.ok(before.form < 0);
  });

  it('is null when 150% never crosses', () => {
    const projection = project(tired, tiredFrom, TODAY, scenario({ beforePct: 150, afterPct: 150 }), []);
    assert.equal(projection.turnsPositive, null);
  });
});

describe('project / peak', () => {
  it('takes the earliest day on a plateau of equal forms', () => {
    const from = addDays(TODAY, -400);
    const perDay = history(steady(from, addDays(TODAY, -1), 50));
    const projection = project(perDay, from, TODAY, scenario(), []);
    assert.equal(projection.peak.date, TODAY);
    assert.equal(projection.peak.fitness, projection.start.fitness);
  });

  it('reports fitness on the eve of the peak and of the switch', () => {
    const from = addDays(TODAY, -100);
    const perDay = history(steady(from, addDays(TODAY, -1), 60));
    const projection = project(perDay, from, TODAY, scenario({ beforePct: 0, afterPct: 0 }), []);
    const eve = projection.series.find((d) => d.date === addDays(projection.peak.date, -1))!;
    assert.equal(projection.peak.fitness, eve.fitness);
    assert.equal(projection.switchDay.date, TODAY);
    assert.equal(projection.switchDay.fitness, projection.start.fitness);
  });
});

describe('project / placement', () => {
  it('places the event form among the measured forms only', () => {
    const from = addDays(TODAY, -100);
    const perDay = history(steady(from, addDays(TODAY, -1), 60));
    const sorted = [-30, -12, -5, 0, 4, 9, 20];
    const projection = project(perDay, from, TODAY, scenario({ beforePct: 0, afterPct: 0 }), sorted);
    const placed = placeForm(sorted, projection.event.form);
    assert.equal(projection.event.percentile, placed.percentile);
    assert.equal(projection.event.rank, placed.rank);
    assert.equal(projection.event.band, placed.band);
    assert.equal(projection.event.measuredDays, sorted.length);
  });
});

describe('project / estimated', () => {
  it('shades projected days for 42 days after an unmeasured ride', () => {
    const from = addDays(TODAY, -100);
    const perDay = history(steady(from, addDays(TODAY, -1), 40));
    perDay.set(addDays(TODAY, -2), { load: 10, rides: 1, unmeasured: 1 });
    const projection = project(perDay, from, TODAY, scenario({ eventDate: addDays(TODAY, 45) }), []);
    const at = (n: number) => projection.series.find((d) => d.date === addDays(TODAY, n))!;
    assert.equal(at(39).estimated, true);
    assert.equal(at(40).estimated, false);
  });
});

describe('project / lessSureUntil', () => {
  const from = addDays(TODAY, -100);

  it('is the first day the window is clear of the last unmeasured ride', () => {
    const perDay = history(steady(from, addDays(TODAY, -1), 40));
    perDay.set(addDays(TODAY, -2), { load: 10, rides: 1, unmeasured: 1 });
    /* Past the event too: it is reported even when the event is still less sure. */
    const projection = project(perDay, from, TODAY, scenario({ eventDate: addDays(TODAY, 10) }), []);
    assert.equal(projection.lessSureUntil, addDays(TODAY, 40));
  });

  it('is null with no unmeasured ride', () => {
    const perDay = history(steady(from, addDays(TODAY, -1), 40));
    assert.equal(project(perDay, from, TODAY, scenario(), []).lessSureUntil, null);
  });

  it('is null when the window is clear by today', () => {
    const perDay = history(steady(from, addDays(TODAY, -1), 40));
    perDay.set(addDays(TODAY, -42), { load: 10, rides: 1, unmeasured: 1 });
    assert.equal(project(perDay, from, TODAY, scenario(), []).lessSureUntil, null);
  });
});

describe('scenarioError', () => {
  const bad = (overrides: Partial<Scenario>, name?: string) =>
    scenarioError(scenario(overrides), TODAY, name);

  it('names the first thing wrong, as a sentence', () => {
    assert.equal(bad({ eventDate: TODAY }), 'The event date must be after today.');
    assert.match(bad({ eventDate: addDays(TODAY, 181) })!, /event date/i);
    assert.match(bad({ switchDate: addDays(TODAY, -1) })!, /switch date/i);
    assert.match(bad({ switchDate: addDays(TODAY, 31) })!, /switch date/i);
    assert.match(bad({ beforePct: 30 })!, /before/i);
    assert.match(bad({ afterPct: 30 })!, /after/i);
    assert.match(bad({ eventDate: '2026-13-40' })!, /event date/i);
    assert.match(bad({}, 'x'.repeat(61))!, /name/i);
  });

  it('accepts the default scenario, the 180-day limit and a 60-character name', () => {
    assert.equal(scenarioError(defaultScenario(TODAY), TODAY), null);
    assert.equal(bad({ eventDate: addDays(TODAY, 180) }), null);
    assert.equal(bad({}, 'x'.repeat(60)), null);
  });
});

describe('defaultScenario', () => {
  it('is rest from today for 28 days', () => {
    assert.deepEqual(defaultScenario(TODAY), {
      eventDate: addDays(TODAY, 28),
      switchDate: TODAY,
      beforePct: 0,
      afterPct: 0,
    });
  });
});

describe('plan storage and planningReport', () => {
  /** An in-memory database with one ride a day from `from` to yesterday, and daily_load filled. */
  function seeded(from: string | null = addDays(TODAY, -100)) {
    const database = openDatabase(':memory:');
    if (from) {
      const insert = database.prepare(
        `INSERT INTO activity (activity_id, activity_type, start_time_local, local_date,
                               duration_s, avg_hr, activity_training_load, imported_at)
         VALUES (?, 'road_biking', '2024-01-01 09:00:00', ?, 3600, 140, 40, '2024-01-01')`,
      );
      let id = 1;
      for (let d = from; d < TODAY; d = addDays(d, 1)) insert.run(id++, d);

      const inputs = dailyInputs(database)!;
      const insertRow = database.prepare(
        `INSERT INTO daily_load (local_date, load_points, ride_count, fitness, fatigue, form,
                                 is_warmup, unmeasured_rides, is_estimated, formula_version, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', '2024-01-01')`,
      );
      for (const r of computeLoadSeries(inputs.perDay, inputs.from, addDays(TODAY, -1))) {
        insertRow.run(
          r.date, r.load, r.rides, r.fitness, r.fatigue, r.form,
          r.isWarmup ? 1 : 0, r.unmeasured, r.isEstimated ? 1 : 0,
        );
      }
    }
    return database;
  }

  const saved = (overrides: Partial<Scenario> = {}) => ({
    name: 'Spring race' as string | null,
    ...scenario(overrides),
  });

  it('is null with no rides', () => {
    const database = seeded(null);
    assert.equal(planningReport(null, database, TODAY), null);
    database.close();
  });

  it('is null when the history starts today, with no complete day to project from', () => {
    const database = openDatabase(':memory:');
    database
      .prepare(
        `INSERT INTO activity (activity_id, activity_type, start_time_local, local_date,
                               duration_s, avg_hr, activity_training_load, imported_at)
         VALUES (1, 'road_biking', '2026-10-25 09:00:00', ?, 3600, 140, 40, '2026-10-25')`,
      )
      .run(TODAY);
    assert.equal(planningReport(null, database, TODAY), null);
    database.close();
  });

  it('projects the default with no plan: rest from today to four weeks ahead', () => {
    const database = seeded();
    const report = planningReport(null, database, TODAY)!;
    assert.equal(report.scenario.source, 'default');
    assert.equal(report.scenario.eventDate, addDays(TODAY, 28));
    assert.equal(report.scenario.afterPct, 0);
    assert.equal(report.plan, null);
    assert.equal(report.past, null);
    database.close();
  });

  it('round-trips a saved plan, name null included, and keeps one row', () => {
    const database = seeded();
    const first = saved({ switchDate: addDays(TODAY, 5), beforePct: 50, afterPct: 125 });
    savePlan(first, database);
    assert.deepEqual(readPlan(database), first);

    const second = { ...saved({ afterPct: 25 }), name: null };
    savePlan(second, database);
    assert.deepEqual(readPlan(database), second);
    const count = database.prepare(`SELECT COUNT(*) AS n FROM plan`).get() as { n: number };
    assert.equal(count.n, 1);
    database.close();
  });

  it('projects a saved future plan', () => {
    const database = seeded();
    savePlan(saved(), database);
    const report = planningReport(null, database, TODAY)!;
    assert.equal(report.scenario.source, 'saved');
    assert.equal(report.scenario.eventDate, addDays(TODAY, 30));
    assert.equal(report.plan?.name, 'Spring race');
    database.close();
  });

  it('falls back to the default for a plan in the past, and names it', () => {
    const database = seeded();
    const yesterday = addDays(TODAY, -1);
    savePlan(saved({ eventDate: yesterday, switchDate: addDays(TODAY, -10) }), database);
    const report = planningReport(null, database, TODAY)!;
    assert.equal(report.past, yesterday);
    assert.equal(report.scenario.source, 'default');
    database.close();
  });

  it('treats a plan whose event is today as neither past nor current', () => {
    const database = seeded();
    savePlan(saved({ eventDate: TODAY, switchDate: addDays(TODAY, -10) }), database);
    const report = planningReport(null, database, TODAY)!;
    assert.equal(report.past, null);
    assert.equal(report.scenario.source, 'default');
    database.close();
  });

  it('lets a query override the saved plan without touching it', () => {
    const database = seeded();
    const plan = saved();
    savePlan(plan, database);
    const report = planningReport(scenario({ afterPct: 50 }), database, TODAY)!;
    assert.equal(report.scenario.source, 'query');
    assert.equal(report.scenario.afterPct, 50);
    assert.deepEqual(report.plan, plan);
    database.close();
  });

  it('forgets the plan once cleared', () => {
    const database = seeded();
    savePlan(saved(), database);
    clearPlan(database);
    assert.equal(readPlan(database), null);
    database.close();
  });
});
