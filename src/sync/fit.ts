import { Decoder, Stream } from '@garmin/fitsdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { downloadActivityFile } from '../garmin/client.js';

/**
 * Durations we keep a peak-mean-power value for.
 * 1200 s is the one Garmin also reports (`maxPowerTwentyMinutes`), which makes it
 * the cross-check that tells us the parse is correct.
 */
export const POWER_CURVE_DURATIONS = [
  1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400,
] as const;

interface FitRecord {
  timestamp?: Date;
  power?: number;
  heartRate?: number;
  cadence?: number;
}

export interface ParsedFit {
  recordCount: number;
  powerRecords: number;
  sampleRateSeconds: number;
  powerCurve: Map<number, number>;
}

/**
 * Best average power over each window, by sliding sum.
 *
 * Gaps in the power stream count as zero watts rather than being skipped, which is
 * the conservative reading: a coasting second really was zero watts at the pedals.
 */
export function computePowerCurve(
  power: number[],
  sampleRateSeconds: number,
): Map<number, number> {
  const curve = new Map<number, number>();

  for (const duration of POWER_CURVE_DURATIONS) {
    const window = Math.max(1, Math.round(duration / sampleRateSeconds));
    if (window > power.length) continue;

    let sum = 0;
    let best = 0;
    for (let i = 0; i < power.length; i++) {
      sum += power[i] ?? 0;
      if (i >= window) sum -= power[i - window] ?? 0;
      if (i >= window - 1) best = Math.max(best, sum / window);
    }
    curve.set(duration, Math.round(best * 10) / 10);
  }

  return curve;
}

export function parseFit(buffer: Buffer): ParsedFit {
  const stream = Stream.fromBuffer(buffer);
  if (!Decoder.isFIT(stream)) throw new Error('Not a FIT file');

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) throw new Error('FIT integrity check failed');

  const { messages } = decoder.read() as { messages: { recordMesgs?: FitRecord[] } };
  const records = messages.recordMesgs ?? [];
  if (records.length === 0) throw new Error('FIT file has no record messages');

  const first = records[0]?.timestamp;
  const second = records[1]?.timestamp;
  const sampleRateSeconds =
    first && second ? Math.max(1, (second.getTime() - first.getTime()) / 1000) : 1;

  const power = records.map((r) => r.power ?? 0);
  const powerRecords = records.filter((r) => r.power != null).length;

  return {
    recordCount: records.length,
    powerRecords,
    sampleRateSeconds,
    powerCurve: powerRecords > 0 ? computePowerCurve(power, sampleRateSeconds) : new Map(),
  };
}

/**
 * Pull the single `{id}_ACTIVITY.fit` entry out of Garmin's ZIP without a zip dependency.
 *
 * Garmin streams the archive, so the local file header carries a zero compressed size and
 * the real one only appears in the central directory. Reading the local header alone gives
 * an empty slice and inflate fails with "unexpected end of file".
 */
export function extractFitFromZip(zip: Buffer): Buffer {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;

  if (zip.length < 22 || zip.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error('Not a ZIP archive');
  }

  // The end-of-central-directory record sits in the last 22 bytes plus any comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP has no end-of-central-directory record');

  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
    throw new Error('ZIP central directory not found where the EOCD points');
  }

  const method = zip.readUInt16LE(centralOffset + 10);
  const compressedSize = zip.readUInt32LE(centralOffset + 20);
  const localOffset = zip.readUInt32LE(centralOffset + 42);

  const nameLength = zip.readUInt16LE(localOffset + 26);
  const extraLength = zip.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = zip.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

const nowIso = () => new Date().toISOString();

function mark(
  activityId: number,
  status: string,
  fields: Partial<{
    byte_size: number;
    record_count: number;
    power_records: number;
    sample_rate_s: number;
    error: string;
  }> = {},
): void {
  db()
    .prepare(
      `INSERT INTO fit_file (activity_id, status, byte_size, record_count, power_records, sample_rate_s, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET
         status = excluded.status, byte_size = excluded.byte_size,
         record_count = excluded.record_count, power_records = excluded.power_records,
         sample_rate_s = excluded.sample_rate_s, error = excluded.error,
         updated_at = excluded.updated_at`,
    )
    .run(
      activityId,
      status,
      fields.byte_size ?? null,
      fields.record_count ?? null,
      fields.power_records ?? null,
      fields.sample_rate_s ?? null,
      fields.error ?? null,
      nowIso(),
    );
}

export interface FitSyncResult {
  downloaded: number;
  skipped: number;
  failed: number;
}

/**
 * Download and parse FIT files for rides that have a power meter.
 *
 * Rides without power are marked `skipped`: there is no power curve to extract, and
 * at ~800 KB each there is no reason to hold the file.
 */
export async function syncFitFiles(
  options: { onProgress?: (message: string) => void; keepFiles?: boolean } = {},
): Promise<FitSyncResult> {
  const database = db();
  const log = options.onProgress ?? (() => {});
  const result: FitSyncResult = { downloaded: 0, skipped: 0, failed: 0 };

  const pending = database
    .prepare(
      `SELECT a.activity_id, a.avg_power
         FROM activity a
         LEFT JOIN fit_file f ON f.activity_id = a.activity_id
        WHERE f.activity_id IS NULL OR f.status IN ('pending','failed')
        ORDER BY a.local_date DESC`,
    )
    .all() as { activity_id: number; avg_power: number | null }[];

  const withPower = pending.filter((row) => row.avg_power != null);
  for (const row of pending) {
    if (row.avg_power == null) {
      mark(row.activity_id, 'skipped');
      result.skipped++;
    }
  }

  log(`  ${withPower.length} powered rides to fetch, ${result.skipped} skipped (no power meter)`);
  if (options.keepFiles) mkdirSync(config.fitCachePath, { recursive: true });

  const insertPoint = database.prepare(
    `INSERT INTO power_curve (activity_id, duration_s, watts) VALUES (?, ?, ?)
     ON CONFLICT(activity_id, duration_s) DO UPDATE SET watts = excluded.watts`,
  );

  for (const [index, row] of withPower.entries()) {
    try {
      const zip = await downloadActivityFile(row.activity_id);
      const fit = extractFitFromZip(zip);
      if (options.keepFiles) {
        writeFileSync(join(config.fitCachePath, `${row.activity_id}.fit`), fit);
      }

      const parsed = parseFit(fit);
      database.transaction(() => {
        for (const [duration, watts] of parsed.powerCurve) {
          insertPoint.run(row.activity_id, duration, watts);
        }
      })();

      mark(row.activity_id, 'parsed', {
        byte_size: fit.length,
        record_count: parsed.recordCount,
        power_records: parsed.powerRecords,
        sample_rate_s: parsed.sampleRateSeconds,
      });
      result.downloaded++;
    } catch (error) {
      mark(row.activity_id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
    }

    if ((index + 1) % 10 === 0) log(`  fit ${index + 1}/${withPower.length}`);
  }

  return result;
}
