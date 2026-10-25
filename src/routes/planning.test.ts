import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/index.js';
import { addDays, computeLoadSeries, dailyInputs } from '../calc/load.js';
import { readPlan } from '../calc/planning.js';
import { planningRoutes } from './planning.js';

const TODAY = '2026-10-25';
const EVENT = addDays(TODAY, 21);
const SWITCH = addDays(TODAY, 7);

/** An in-memory database with one ride a day from 100 days ago to yesterday, and daily_load filled. */
function seeded(withHistory = true) {
  const database = openDatabase(':memory:');
  if (!withHistory) return database;
  const insert = database.prepare(
    `INSERT INTO activity (activity_id, activity_type, start_time_local, local_date,
                           duration_s, avg_hr, activity_training_load, imported_at)
     VALUES (?, 'road_biking', '2024-01-01 09:00:00', ?, 3600, 140, 40, '2024-01-01')`,
  );
  let id = 1;
  for (let d = addDays(TODAY, -100); d < TODAY; d = addDays(d, 1)) insert.run(id++, d);

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
  return database;
}

const plan = (overrides: Record<string, unknown> = {}) => ({
  name: 'Gran fondo',
  eventDate: EVENT,
  switchDate: SWITCH,
  beforePct: 50,
  afterPct: 0,
  ...overrides,
});

const put = (body: unknown) => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const query = (event = EVENT, sw = SWITCH, before = '50', after = '0') =>
  `/?event=${event}&switch=${sw}&before=${before}&after=${after}`;

describe('planning routes', () => {
  function setup(database = seeded()) {
    return { database, app: planningRoutes(() => database, () => TODAY) };
  }

  it('GET with no history returns null', async () => {
    const { app } = setup(seeded(false));
    const res = await app.request('/');
    assert.equal(res.status, 200);
    assert.equal(await res.json(), null);
  });

  it('GET with a query projects it without saving', async () => {
    const { app, database } = setup();
    const res = await app.request(query());
    assert.equal(res.status, 200);
    const body = (await res.json()) as { scenario: { source: string } };
    assert.equal(body.scenario.source, 'query');
    assert.equal(readPlan(database), null);
  });

  it('GET rejects a bad percentage, a bad date and a partial query with 400', async () => {
    const { app } = setup();
    const bad = await app.request(query(EVENT, SWITCH, 'abc'));
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /before/);

    assert.equal((await app.request(query('2026-13-40'))).status, 400);
    assert.equal((await app.request(`/?event=${EVENT}`)).status, 400);
  });

  it('PUT without a JSON content type returns 415', async () => {
    const { app } = setup();
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'eventDate=x',
    });
    assert.equal(res.status, 415);
  });

  it('PUT saves a valid plan and GET then reads it back', async () => {
    const { app } = setup();
    const res = await app.request('/', put(plan({ name: '  Gran fondo ' })));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { plan: { name: string } };
    assert.equal(body.plan.name, 'Gran fondo');

    const next = (await (await app.request('/')).json()) as { scenario: { source: string } };
    assert.equal(next.scenario.source, 'saved');
  });

  it('PUT turns an empty name into null and rejects wrong types', async () => {
    const { app, database } = setup();
    assert.equal((await app.request('/', put(plan({ name: '   ' })))).status, 200);
    assert.equal(readPlan(database)!.name, null);
    assert.equal((await app.request('/', put(plan({ beforePct: '50' })))).status, 400);
    assert.equal((await app.request('/', put(plan({ name: 5 })))).status, 400);
    const broken = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    assert.equal(broken.status, 400);
  });

  it('PUT with an invalid plan returns 400 and keeps the saved one', async () => {
    const { app, database } = setup();
    await app.request('/', put(plan()));
    const res = await app.request('/', put(plan({ name: 'Other', afterPct: 30 })));
    assert.equal(res.status, 400);
    assert.equal(readPlan(database)!.name, 'Gran fondo');
  });

  it('DELETE clears the plan and returns 204', async () => {
    const { app } = setup();
    await app.request('/', put(plan()));
    const res = await app.request('/', { method: 'DELETE' });
    assert.equal(res.status, 204);
    const body = (await (await app.request('/')).json()) as {
      plan: unknown;
      scenario: { source: string };
    };
    assert.equal(body.plan, null);
    assert.equal(body.scenario.source, 'default');
  });
});
