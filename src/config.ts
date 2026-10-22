import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and add your Garmin Personal API key ` +
        `(create one at https://connect.garmin.com/app/settings/personalApiToken).`,
    );
  }
  return value;
}

export const config = {
  apiKey: required('GARMIN_PERSONAL_API_KEY'),
  baseUrl: process.env.GARMIN_PERSONAL_API_BASE_URL ?? 'https://personal.connectapi.garmin.com',
  databasePath: resolve(process.env.DATABASE_PATH ?? './data/garmin.db'),
  fitCachePath: resolve(process.env.FIT_CACHE_PATH ?? './data/fit-cache'),
  tokenCachePath: resolve(process.env.TOKEN_CACHE_PATH ?? './data/token.json'),
  displayTimeZone: process.env.DISPLAY_TIMEZONE ?? 'Europe/Athens',
  apiPort: Number(process.env.API_PORT ?? 8787),
} as const;

/**
 * The activity search endpoint returns HTTP 500 — not 400 — for limit >= 64.
 * 62 is the highest value that works; 50 leaves headroom.
 */
export const ACTIVITY_PAGE_SIZE = 50;

/** Re-check this many days of recent activities on every sync, to pick up edits. */
export const RESYNC_WINDOW_DAYS = 30;
