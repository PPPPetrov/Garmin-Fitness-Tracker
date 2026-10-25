import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  clearPlan,
  planningReport,
  savePlan,
  scenarioError,
  type SavedPlan,
  type Scenario,
} from '../calc/planning.js';
import { today as todayLocal } from '../calc/load.js';
import { db } from '../db/index.js';

/**
 * The three planning routes, as their own Hono app so a test can call them with
 * `app.request()` without importing server.ts, which starts listening on import.
 * The database and the day are parameters so a test can pass an in-memory database and a
 * fixed date.
 */
export function planningRoutes(
  getDb: () => Database.Database = db,
  getToday: () => string = todayLocal,
): Hono {
  const app = new Hono();

  // With no parameters: the saved plan, or the default. With all four: that scenario,
  // projected and not saved. The percentages arrive as text, so an empty or non-numeric
  // value becomes NaN, which scenarioError rejects by naming the field.
  app.get('/', (c) => {
    const database = getDb();
    const today = getToday();
    const event = c.req.query('event');
    const switchDate = c.req.query('switch');
    const before = c.req.query('before');
    const after = c.req.query('after');
    const given = [event, switchDate, before, after].filter((v) => v !== undefined).length;

    if (given === 0) return c.json(planningReport(null, database, today));
    if (given < 4) return c.json({ error: 'Give event, switch, before and after together.' }, 400);

    const percent = (text: string | undefined) =>
      text === undefined || text.trim() === '' ? NaN : Number(text);
    const scenario: Scenario = {
      eventDate: event!,
      switchDate: switchDate!,
      beforePct: percent(before),
      afterPct: percent(after),
    };
    const error = scenarioError(scenario, today);
    if (error) return c.json({ error }, 400);
    return c.json(planningReport(scenario, database, today));
  });

  // The JSON-only rule keeps a plain cross-site form post from writing to this server.
  app.put('/', async (c) => {
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'Send the plan as JSON.' }, 415);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'The body must be valid JSON.' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'The body must be a JSON object.' }, 400);
    }
    const { name, eventDate, switchDate, beforePct, afterPct } = body as Record<string, unknown>;

    if (typeof eventDate !== 'string') return c.json({ error: 'The event date must be a string.' }, 400);
    if (typeof switchDate !== 'string') return c.json({ error: 'The switch date must be a string.' }, 400);
    if (typeof beforePct !== 'number') {
      return c.json({ error: 'The share before the switch must be a number.' }, 400);
    }
    if (typeof afterPct !== 'number') {
      return c.json({ error: 'The share after the switch must be a number.' }, 400);
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return c.json({ error: 'The name must be a string or null.' }, 400);
    }

    const trimmed = typeof name === 'string' ? name.trim() : '';
    const plan: SavedPlan = {
      name: trimmed === '' ? null : trimmed,
      eventDate,
      switchDate,
      beforePct,
      afterPct,
    };
    const today = getToday();
    const error = scenarioError(plan, today, plan.name);
    if (error) return c.json({ error }, 400);

    const database = getDb();
    savePlan(plan, database);
    return c.json(planningReport(null, database, today));
  });

  app.delete('/', (c) => {
    clearPlan(getDb());
    return c.body(null, 204);
  });

  return app;
}
