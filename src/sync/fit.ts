import { Decoder, Stream } from '@garmin/fitsdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { downloadActivityFile } from '../garmin/client.js';
import { verifyPowerCurves, type PowerCheckResult } from './powerCheck.js';

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
 * Lay power readings out on a one-second grid by their timestamps.
 *
 * Each reading stands for `holdSeconds` — the file's own recording interval — or until
 * the next reading, whichever is sooner. A longer gap is a pause or a lost sensor, and
 * counts as zero watts rather than having the reading before it stretched across it.
 * Windows are then measured in seconds of the ride, not in records, so a pause can
 * neither stretch nor squeeze them.
 */
export function toSecondStream(
  samples: { seconds: number; watts: number }[],
  holdSeconds = 1,
): number[] {
  const last = samples.at(-1);
  if (!last) return [];

  const hold = Math.max(1, Math.round(holdSeconds));
  const stream = new Array<number>(Math.floor(last.seconds) + hold).fill(0);
  samples.forEach((sample, i) => {
    const from = Math.floor(sample.seconds);
    const next = samples[i + 1];
    const until = Math.min(next ? Math.floor(next.seconds) : Infinity, from + hold);
    for (let t = from; t < until; t++) stream[t] = sample.watts;
  });
  return stream;
}

/**
 * Best average power over each window, by sliding sum over a one-second stream.
 *
 * Gaps in the power stream count as zero watts rather than being skipped, which is
 * the conservative reading: a coasting second really was zero watts at the pedals.
 */
export function computePowerCurve(perSecond: number[]): Map<number, number> {
  const curve = new Map<number, number>();

  for (const window of POWER_CURVE_DURATIONS) {
    if (window > perSecond.length) continue;

    let sum = 0;
    let best = 0;
    for (let i = 0; i < perSecond.length; i++) {
      sum += perSecond[i] ?? 0;
      if (i >= window) sum -= perSecond[i - window] ?? 0;
      if (i >= window - 1) best = Math.max(best, sum / window);
    }
    curve.set(window, Math.round(best * 10) / 10);
  }

  return curve;
}

/** The commonest gap between records, in seconds: the rate the file was recorded at. */
function typicalGapSeconds(times: number[]): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < times.length; i++) {
    const gap = Math.round((times[i]! - times[i - 1]!) / 1000);
    if (gap > 0) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  let typical = 1;
  let most = 0;
  for (const [gap, count] of counts) {
    if (count > most) [typical, most] = [gap, count];
  }
  return typical;
}

export function parseFit(buffer: Buffer): ParsedFit {
  const stream = Stream.fromBuffer(buffer);
  if (!Decoder.isFIT(stream)) throw new Error('Not a FIT file');

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) throw new Error('FIT integrity check failed');

  const { messages } = decoder.read() as { messages: { recordMesgs?: FitRecord[] } };
  const records = messages.recordMesgs ?? [];
  if (records.length === 0) throw new Error('FIT file has no record messages');

  const timed = records.filter((r): r is FitRecord & { timestamp: Date } => r.timestamp != null);
  const times = timed.map((r) => r.timestamp.getTime());
  const start = times[0] ?? 0;
  const powerRecords = records.filter((r) => r.power != null).length;
  const sampleRateSeconds = typicalGapSeconds(times);

  return {
    recordCount: records.length,
    powerRecords,
    sampleRateSeconds,
    powerCurve:
      powerRecords > 0
        ? computePowerCurve(
            toSecondStream(
              timed.map((r, i) => ({ seconds: (times[i]! - start) / 1000, watts: r.power ?? 0 })),
              sampleRateSeconds,
            ),
          )
        : new Map(),
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
  /** Parsed again from a file already on disk, with no request. */
  reparsed: number;
  skipped: number;
  failed: number;
  check: PowerCheckResult;
}

/**
 * Download and parse FIT files for rides that have a power meter.
 *
 * Rides without power are marked `skipped`: there is no power curve to extract, and
 * at ~800 KB each there is no reason to hold the file.
 *
 * Files are kept by default, so a change to the parser costs a re-read of the disk
 * rather than 135 downloads on a key that can be revoked. A ride already on disk is
 * parsed from there. Every curve is then checked against Garmin's own figures, and
 * one that disagrees goes back to `pending`.
 */
export async function syncFitFiles(
  options: { onProgress?: (message: string) => void; keepFiles?: boolean } = {},
): Promise<FitSyncResult> {
  const database = db();
  const log = options.onProgress ?? (() => {});
  const keepFiles = options.keepFiles ?? true;
  const result: Omit<FitSyncResult, 'check'> = { downloaded: 0, reparsed: 0, skipped: 0, failed: 0 };

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
  if (keepFiles) mkdirSync(config.fitCachePath, { recursive: true });

  const clearCurve = database.prepare('DELETE FROM power_curve WHERE activity_id = ?');
  const insertPoint = database.prepare(
    `INSERT INTO power_curve (activity_id, duration_s, watts) VALUES (?, ?, ?)
     ON CONFLICT(activity_id, duration_s) DO UPDATE SET watts = excluded.watts`,
  );

  for (const [index, row] of withPower.entries()) {
    try {
      const cached = join(config.fitCachePath, `${row.activity_id}.fit`);
      const onDisk = existsSync(cached);
      const fit = onDisk
        ? readFileSync(cached)
        : extractFitFromZip(await downloadActivityFile(row.activity_id));
      if (keepFiles && !onDisk) writeFileSync(cached, fit);

      const parsed = parseFit(fit);
      database.transaction(() => {
        // A durations list that shrinks must not leave the old parse's points behind.
        clearCurve.run(row.activity_id);
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
      if (onDisk) result.reparsed++;
      else result.downloaded++;
    } catch (error) {
      mark(row.activity_id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
    }

    if ((index + 1) % 10 === 0) log(`  fit ${index + 1}/${withPower.length}`);
  }

  return { ...result, check: verifyPowerCurves() };
}
