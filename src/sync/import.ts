import { ACTIVITY_PAGE_SIZE, RESYNC_WINDOW_DAYS } from '../config.js';
import { db } from '../db/index.js';
import {
  getActivity,
  searchActivities,
  type ActivityDetail,
  type ActivityListItem,
} from '../garmin/client.js';

export interface SyncOptions {
  /** Stop paging once a page contains only activities we already hold. */
  incremental?: boolean;
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  seen: number;
  added: number;
  updated: number;
  detailsFetched: number;
  coverageStart: string | null;
  coverageEnd: string | null;
}

const nowIso = () => new Date().toISOString();

/** Garmin's startTimeLocal is `YYYY-MM-DD HH:MM:SS` in the activity's own timezone. */
function localDateOf(startTimeLocal: string): string {
  return startTimeLocal.slice(0, 10);
}

function upsertFromList(item: ActivityListItem): 'added' | 'updated' {
  const database = db();
  const existing = database
    .prepare('SELECT activity_id FROM activity WHERE activity_id = ?')
    .get(item.activityId);

  database
    .prepare(
      `INSERT INTO activity (
         activity_id, activity_name, activity_type, start_time_local, start_time_gmt,
         local_date, duration_s, moving_duration_s, elapsed_duration_s, distance_m,
         elevation_gain_m, calories, avg_hr, max_hr, avg_power, normalized_power, imported_at
       ) VALUES (
         @activity_id, @activity_name, @activity_type, @start_time_local, @start_time_gmt,
         @local_date, @duration_s, @moving_duration_s, @elapsed_duration_s, @distance_m,
         @elevation_gain_m, @calories, @avg_hr, @max_hr, @avg_power, @normalized_power, @imported_at
       )
       ON CONFLICT(activity_id) DO UPDATE SET
         activity_name = excluded.activity_name,
         distance_m = excluded.distance_m,
         duration_s = excluded.duration_s,
         moving_duration_s = excluded.moving_duration_s,
         elapsed_duration_s = excluded.elapsed_duration_s,
         elevation_gain_m = excluded.elevation_gain_m,
         avg_hr = excluded.avg_hr,
         max_hr = excluded.max_hr,
         avg_power = excluded.avg_power,
         normalized_power = excluded.normalized_power`,
    )
    .run({
      activity_id: item.activityId,
      activity_name: item.activityName,
      activity_type: item.activityType?.typeKey ?? 'unknown',
      start_time_local: item.startTimeLocal,
      start_time_gmt: item.startTimeGMT ?? null,
      local_date: localDateOf(item.startTimeLocal),
      duration_s: item.duration,
      moving_duration_s: item.movingDuration,
      elapsed_duration_s: item.elapsedDuration,
      distance_m: item.distance,
      elevation_gain_m: item.elevationGain,
      calories: item.calories,
      avg_hr: item.averageHR || null,
      max_hr: item.maxHR || null,
      avg_power: item.avgPower,
      normalized_power: item.normPower,
      imported_at: nowIso(),
    });

  database
    .prepare(
      `INSERT INTO activity_raw (activity_id, list_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET list_json = excluded.list_json, fetched_at = excluded.fetched_at`,
    )
    .run(item.activityId, JSON.stringify(item), nowIso());

  return existing ? 'updated' : 'added';
}

function applyDetail(activityId: number, detail: ActivityDetail): void {
  const s = detail.summaryDTO;
  const database = db();

  database
    .prepare(
      `UPDATE activity SET
         activity_type = COALESCE(?, activity_type),
         time_zone = ?,
         duration_s = COALESCE(?, duration_s),
         moving_duration_s = COALESCE(?, moving_duration_s),
         elapsed_duration_s = COALESCE(?, elapsed_duration_s),
         distance_m = COALESCE(?, distance_m),
         elevation_gain_m = COALESCE(?, elevation_gain_m),
         elevation_loss_m = ?,
         calories = COALESCE(?, calories),
         avg_hr = COALESCE(?, avg_hr),
         max_hr = COALESCE(?, max_hr),
         avg_cadence = ?,
         avg_temperature = ?,
         avg_power = COALESCE(?, avg_power),
         max_power = ?,
         normalized_power = COALESCE(?, normalized_power),
         max_power_20min = ?,
         ftp_at_ride = ?,
         intensity_factor = ?,
         training_stress_score = ?,
         activity_training_load = ?,
         training_effect = ?,
         anaerobic_training_effect = ?,
         training_effect_label = ?,
         location_name = ?,
         uploaded_at = ?,
         last_updated_at = ?,
         detail_fetched = 1
       WHERE activity_id = ?`,
    )
    .run(
      detail.activityTypeDTO?.typeKey ?? null,
      detail.timeZoneUnitDTO?.timeZone ?? null,
      s?.duration ?? null,
      s?.movingDuration ?? null,
      s?.elapsedDuration ?? null,
      s?.distance ?? null,
      s?.elevationGain ?? null,
      s?.elevationLoss ?? null,
      s?.calories ?? null,
      s?.averageHR || null,
      s?.maxHR || null,
      s?.averageBikeCadence ?? null,
      s?.averageTemperature ?? null,
      s?.averagePower ?? null,
      s?.maxPower ?? null,
      s?.normalizedPower ?? null,
      s?.maxPowerTwentyMinutes ?? null,
      s?.functionalThresholdPower ?? null,
      s?.intensityFactor ?? null,
      s?.trainingStressScore ?? null,
      s?.activityTrainingLoad ?? null,
      s?.trainingEffect ?? null,
      s?.anaerobicTrainingEffect ?? null,
      s?.trainingEffectLabel ?? null,
      detail.locationName ?? null,
      detail.metadataDTO?.uploadedDate ?? null,
      detail.metadataDTO?.lastUpdateDate ?? null,
      activityId,
    );

  database
    .prepare(
      `INSERT INTO activity_raw (activity_id, detail_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET detail_json = excluded.detail_json, fetched_at = excluded.fetched_at`,
    )
    .run(activityId, JSON.stringify(detail), nowIso());
}

export async function syncActivities(options: SyncOptions = {}): Promise<SyncResult> {
  const database = db();
  const log = options.onProgress ?? (() => {});
  const mode = options.incremental ? 'incremental' : 'full';

  const run = database
    .prepare(`INSERT INTO sync_run (started_at, mode, status) VALUES (?, ?, 'running')`)
    .run(nowIso(), mode);
  const runId = run.lastInsertRowid;

  const result: SyncResult = {
    seen: 0,
    added: 0,
    updated: 0,
    detailsFetched: 0,
    coverageStart: null,
    coverageEnd: null,
  };

  try {
    let start = 0;
    for (;;) {
      const page = await searchActivities({ start, limit: ACTIVITY_PAGE_SIZE });
      if (!page || page.length === 0) break;

      let newInPage = 0;
      for (const item of page) {
        result.seen++;
        if (upsertFromList(item) === 'added') {
          result.added++;
          newInPage++;
        } else {
          result.updated++;
        }
      }

      log(`  listed ${result.seen} activities (${result.added} new)`);
      start += page.length;

      if (page.length < ACTIVITY_PAGE_SIZE) break;

      // Incremental runs stop once a whole page is already known, but always cover
      // the trailing window so edited rides get picked up.
      if (options.incremental && newInPage === 0 && start > RESYNC_WINDOW_DAYS) break;
    }

    // Detail carries everything that matters: training load, TSS, FTP, training effect.
    const pending = database
      .prepare('SELECT activity_id FROM activity WHERE detail_fetched = 0 ORDER BY local_date DESC')
      .all() as { activity_id: number }[];

    log(`  fetching detail for ${pending.length} activities`);
    for (const [index, row] of pending.entries()) {
      const detail = await getActivity(row.activity_id);
      if (detail) {
        applyDetail(row.activity_id, detail);
        result.detailsFetched++;
      }
      if ((index + 1) % 25 === 0) log(`  detail ${index + 1}/${pending.length}`);
    }

    const coverage = database
      .prepare('SELECT MIN(local_date) AS lo, MAX(local_date) AS hi FROM activity')
      .get() as { lo: string | null; hi: string | null };
    result.coverageStart = coverage.lo;
    result.coverageEnd = coverage.hi;

    database
      .prepare(
        `UPDATE sync_run SET finished_at = ?, activities_seen = ?, activities_added = ?,
           activities_updated = ?, details_fetched = ?, coverage_start = ?, coverage_end = ?,
           status = 'ok' WHERE id = ?`,
      )
      .run(
        nowIso(),
        result.seen,
        result.added,
        result.updated,
        result.detailsFetched,
        result.coverageStart,
        result.coverageEnd,
        runId,
      );

    return result;
  } catch (error) {
    database
      .prepare(`UPDATE sync_run SET finished_at = ?, status = 'failed', error = ? WHERE id = ?`)
      .run(nowIso(), error instanceof Error ? error.message : String(error), runId);
    throw error;
  }
}
