import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

/**
 * Open a database at an explicit path and bring its schema up to date.
 * Pass `:memory:` for a throwaway one, as the tests do.
 */
export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(database);
  return database;
}

export function db(): Database.Database {
  instance ??= openDatabase(config.databasePath);
  return instance;
}

/** `CREATE TABLE IF NOT EXISTS` never adds a column to a table that already exists. */
function migrate(database: Database.Database): void {
  const added: Record<string, string[]> = {
    daily_load: [
      'unmeasured_rides INTEGER NOT NULL DEFAULT 0',
      'is_estimated INTEGER NOT NULL DEFAULT 0',
    ],
    activity: [
      'hr_zone_1_s REAL',
      'hr_zone_2_s REAL',
      'hr_zone_3_s REAL',
      'hr_zone_4_s REAL',
      'hr_zone_5_s REAL',
    ],
  };

  for (const [table, columns] of Object.entries(added)) {
    const existing = new Set(
      (database.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name),
    );
    for (const definition of columns) {
      const name = definition.split(' ')[0]!;
      if (!existing.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

export interface ActivityRow {
  activity_id: number;
  activity_name: string | null;
  activity_type: string;
  start_time_local: string;
  local_date: string;
  duration_s: number | null;
  moving_duration_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  normalized_power: number | null;
  max_power_20min: number | null;
  ftp_at_ride: number | null;
  intensity_factor: number | null;
  training_stress_score: number | null;
  activity_training_load: number | null;
  training_effect: number | null;
  location_name: string | null;
  detail_fetched: number;
}
