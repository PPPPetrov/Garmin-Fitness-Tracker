import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import {
  CHANGE_WINDOW_DAYS,
  CONFIDENCE_WINDOW_DAYS,
  currentFormPosition,
} from './calc/form.js';
import {
  bestPowerCurve,
  loadCoverage,
  powerCurveHeldBack,
  recomputeDailyLoad,
  today,
} from './calc/load.js';
import { performanceReport } from './calc/performance.js';
import { zonesInRange } from './calc/zones.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { syncActivities } from './sync/import.js';

const app = new Hono();

let syncInFlight: Promise<unknown> | null = null;

app.get('/api/status', (c) => {
  const database = db();
  const lastRun = database
    .prepare('SELECT * FROM sync_run ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  const coverage = database
    .prepare('SELECT MIN(local_date) AS start, MAX(local_date) AS end, COUNT(*) AS total FROM activity')
    .get() as { start: string | null; end: string | null; total: number };

  return c.json({
    coverage,
    fieldCoverage: loadCoverage(),
    lastSync: lastRun ?? null,
    syncing: syncInFlight !== null,
    timeZone: config.displayTimeZone,
  });
});

app.post('/api/sync', async (c) => {
  if (syncInFlight) return c.json({ started: false, reason: 'A sync is already running' }, 409);

  syncInFlight = syncActivities({ incremental: true })
    .then(() => recomputeDailyLoad())
    .finally(() => {
      syncInFlight = null;
    });

  return c.json({ started: true });
});

app.get('/api/overview', (c) => {
  const database = db();

  const latest = database
    .prepare('SELECT * FROM daily_load ORDER BY local_date DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined;

  const weeks = database
    .prepare(
      `SELECT strftime('%Y-%W', local_date) AS week,
              MIN(local_date) AS week_start,
              COUNT(*) AS rides,
              ROUND(SUM(COALESCE(duration_s,0))/3600.0, 2) AS hours,
              ROUND(SUM(COALESCE(distance_m,0))/1000.0, 1) AS km,
              ROUND(SUM(COALESCE(elevation_gain_m,0))) AS elevation_m,
              ROUND(SUM(COALESCE(activity_training_load,0))) AS load_points
         FROM activity
        WHERE local_date >= date('now', '-182 days')
        GROUP BY week ORDER BY week`,
    )
    .all();

  const recent = database
    .prepare(
      `SELECT activity_id, activity_name, activity_type, local_date, start_time_local,
              distance_m, duration_s, elevation_gain_m, avg_power, normalized_power,
              avg_hr, activity_training_load, training_stress_score, ftp_at_ride
         FROM activity ORDER BY start_time_local DESC LIMIT 10`,
    )
    .all();

  return c.json({ today: latest ?? null, weeks, recent });
});

/**
 * Weekly rollups over an arbitrary range, so the Trends screen can total the period it
 * is showing rather than re-deriving it from the activity list in the browser.
 */
app.get('/api/weeks', (c) => {
  const from = c.req.query('from') ?? '1970-01-01';
  const to = c.req.query('to') ?? '2999-12-31';
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%W', local_date) AS week,
              MIN(local_date) AS week_start,
              COUNT(*) AS rides,
              ROUND(SUM(COALESCE(duration_s,0))/3600.0, 2) AS hours,
              ROUND(SUM(COALESCE(distance_m,0))/1000.0, 1) AS km,
              ROUND(SUM(COALESCE(elevation_gain_m,0))) AS elevation_m,
              ROUND(SUM(COALESCE(activity_training_load,0))) AS load_points
         FROM activity
        WHERE local_date BETWEEN ? AND ?
        GROUP BY week ORDER BY week`,
    )
    .all(from, to);
  return c.json({ rows });
});

app.get('/api/load', (c) => {
  const from = c.req.query('from') ?? '1970-01-01';
  const to = c.req.query('to') ?? '2999-12-31';
  const rows = db()
    .prepare(
      `SELECT local_date, load_points, ride_count, fitness, fatigue, form,
              is_warmup, unmeasured_rides, is_estimated
         FROM daily_load WHERE local_date BETWEEN ? AND ? ORDER BY local_date`,
    )
    .all(from, to);
  return c.json({ rows, formula: 'EWMA of Garmin activity training load; 42d fitness, 7d fatigue' });
});

app.get('/api/form', (c) => {
  return c.json({
    position: currentFormPosition(),
    windows: { change: CHANGE_WINDOW_DAYS, confidence: CONFIDENCE_WINDOW_DAYS },
  });
});

app.get('/api/zones', (c) => {
  const from = c.req.query('from') ?? '1970-01-01';
  const to = c.req.query('to') ?? today();
  return c.json(zonesInRange(from, to));
});

app.get('/api/activities', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const type = c.req.query('type');
  const search = c.req.query('search');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const where: string[] = [];
  const params: unknown[] = [];
  if (type) {
    where.push('activity_type = ?');
    params.push(type);
  }
  if (search) {
    where.push('(activity_name LIKE ? OR location_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (from) {
    where.push('local_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('local_date <= ?');
    params.push(to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const database = db();
  const total = (
    database.prepare(`SELECT COUNT(*) AS n FROM activity ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = database
    .prepare(
      `SELECT activity_id, activity_name, activity_type, local_date, start_time_local,
              distance_m, duration_s, moving_duration_s, elevation_gain_m,
              avg_power, normalized_power, max_power_20min, ftp_at_ride, intensity_factor,
              training_stress_score, activity_training_load, training_effect,
              avg_hr, max_hr, avg_cadence, location_name
         FROM activity ${clause} ORDER BY start_time_local DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return c.json({ total, limit, offset, rows });
});

app.get('/api/activities/:id', (c) => {
  const id = Number(c.req.param('id'));
  const database = db();
  const activity = database.prepare('SELECT * FROM activity WHERE activity_id = ?').get(id);
  if (!activity) return c.json({ error: 'Not found' }, 404);

  const curve = database
    .prepare('SELECT duration_s, watts FROM power_curve WHERE activity_id = ? ORDER BY duration_s')
    .all(id);
  const fit = database.prepare('SELECT * FROM fit_file WHERE activity_id = ?').get(id);

  return c.json({ activity, powerCurve: curve, fit: fit ?? null });
});

app.get('/api/performance', (c) => c.json(performanceReport()));

app.get('/api/power-curve', (c) => {
  const since = c.req.query('since');
  const to = c.req.query('to');
  return c.json({ rows: bestPowerCurve(since, to), heldBack: powerCurveHeldBack(since, to) });
});

/**
 * Every calendar year, counted only as far into it as today is, so a season in progress
 * is held against the same ten months of the season before rather than a whole one.
 */
app.get('/api/seasons', (c) => {
  const throughMonthDay = today().slice(5);
  const rows = db()
    .prepare(
      `SELECT CAST(strftime('%Y', local_date) AS INTEGER) AS year,
              COUNT(*) AS rides,
              ROUND(SUM(COALESCE(duration_s,0))/3600.0, 1) AS hours,
              ROUND(SUM(COALESCE(distance_m,0))/1000.0) AS km,
              ROUND(SUM(COALESCE(elevation_gain_m,0))) AS elevation_m,
              ROUND(SUM(COALESCE(activity_training_load,0))) AS load_points
         FROM activity
        WHERE strftime('%m-%d', local_date) <= ?
        GROUP BY year ORDER BY year DESC`,
    )
    .all(throughMonthDay);
  return c.json({ throughMonthDay, rows });
});

/**
 * The dated steps in Garmin's own threshold estimate. Every powered ride carries the FTP
 * in effect on its date, so the history is already in the activity table; this reduces it
 * to the days the figure actually changed.
 */
app.get('/api/ftp', (c) => {
  const rides = db()
    .prepare(
      `SELECT local_date, ftp_at_ride AS watts FROM activity
        WHERE ftp_at_ride IS NOT NULL ORDER BY local_date`,
    )
    .all() as { local_date: string; watts: number }[];

  const steps: { from: string; watts: number }[] = [];
  for (const ride of rides) {
    if (steps[steps.length - 1]?.watts !== ride.watts) {
      steps.push({ from: ride.local_date, watts: ride.watts });
    }
  }
  return c.json({ steps });
});

app.get('/api/types', (c) => {
  const rows = db()
    .prepare(
      `SELECT activity_type, COUNT(*) AS n,
              SUM(CASE WHEN avg_power IS NOT NULL THEN 1 ELSE 0 END) AS powered,
              -- The two disjoint halves of UNRELIABLE_LOAD_SQL, so these counts sum to
              -- exactly the unreliableLoad figure /api/status reports. A fact shown on
              -- two screens has to be one rule.
              SUM(CASE WHEN activity_training_load IS NULL THEN 1 ELSE 0 END) AS no_load,
              SUM(CASE WHEN activity_training_load IS NOT NULL
                        AND avg_hr IS NULL AND COALESCE(duration_s, 0) > 600
                       THEN 1 ELSE 0 END) AS no_strap
         FROM activity GROUP BY activity_type ORDER BY n DESC`,
    )
    .all();
  return c.json({ rows });
});

// Loopback only: the API has no authentication, and POST /api/sync spends the Garmin key.
// Without a hostname, Node listens on every interface and the LAN can reach it.
serve({ fetch: app.fetch, port: config.apiPort, hostname: '127.0.0.1' }, (info) => {
  process.stdout.write(`API listening on http://127.0.0.1:${info.port}\n`);
});
