import { Encoder, Profile, type Encodable, type FileIdMesg, type RecordMesg } from '@garmin/fitsdk';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import {
  computePowerCurve,
  extractFitFromZip,
  parseFit,
  POWER_CURVE_DURATIONS,
  toSecondStream,
} from './fit.js';

// ---------------------------------------------------------------- zip fixtures

interface ZipOptions {
  /** Garmin streams its archives: the local header then carries a zero size. */
  streaming?: boolean;
  /** 8 = deflate, 0 = stored. */
  method?: 0 | 8;
}

/** Build a one-entry ZIP the way a real writer would, including the streaming variant. */
function makeZip(name: string, contents: Buffer, options: ZipOptions = {}): Buffer {
  const { streaming = false, method = 8 } = options;
  const body = method === 8 ? deflateRawSync(contents) : contents;
  const nameBytes = Buffer.from(name, 'ascii');
  const crc = crc32(contents);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(streaming ? 0x0008 : 0, 6);
  local.writeUInt16LE(method, 8);
  // A streaming writer does not know these yet, so it writes zeros and repeats them
  // in a data descriptor after the payload. Only the central directory is reliable.
  local.writeUInt32LE(streaming ? 0 : crc, 14);
  local.writeUInt32LE(streaming ? 0 : body.length, 18);
  local.writeUInt32LE(streaming ? 0 : contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const descriptor = Buffer.alloc(streaming ? 16 : 0);
  if (streaming) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(body.length, 8);
    descriptor.writeUInt32LE(contents.length, 12);
  }

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(streaming ? 0x0008 : 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42); // local header offset

  const centralOffset = local.length + nameBytes.length + body.length + descriptor.length;
  const centralSize = central.length + nameBytes.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, nameBytes, body, descriptor, central, nameBytes, eocd]);
}

// ---------------------------------------------------------------- fit fixtures

// Generated constants that always exist; the cast only drops the `undefined` that
// noUncheckedIndexedAccess adds. The encoder rejects the string forms at runtime.
const FILE_ID = Profile.MesgNum.FILE_ID as number;
const RECORD = Profile.MesgNum.RECORD as number;

/**
 * Encode a real FIT file whose record messages carry the given power values.
 * `offsets`, when given, are each record's seconds from the start, for files that do
 * not record at a steady rate.
 */
function makeFit(power: (number | null)[], sampleRateSeconds = 1, offsets?: number[]): Buffer {
  const encoder = new Encoder();
  const start = new Date('2026-01-01T06:00:00Z');

  const fileId: Encodable<FileIdMesg> = {
    mesgNum: FILE_ID,
    type: 'activity',
    manufacturer: 'garmin',
    product: 1,
    serialNumber: 1,
    timeCreated: start,
  };
  encoder.writeMesg(fileId);

  power.forEach((watts, i) => {
    const record: Encodable<RecordMesg> = {
      mesgNum: RECORD,
      timestamp: new Date(start.getTime() + (offsets?.[i] ?? i * sampleRateSeconds) * 1000),
      heartRate: 140,
      cadence: 85,
      // A record with no power field is how a ride without a meter actually looks.
      ...(watts !== null ? { power: watts } : {}),
    };
    encoder.writeMesg(record);
  });

  return Buffer.from(encoder.close());
}

// ---------------------------------------------------------------- the tests

describe('computePowerCurve', () => {
  it('finds the best average over each window', () => {
    // A quiet ride with one 5-second effort in the middle.
    const power = [...Array(20).fill(100), ...Array(5).fill(500), ...Array(20).fill(100)];
    const curve = computePowerCurve(power);

    assert.equal(curve.get(1), 500);
    assert.equal(curve.get(5), 500);
    // Ten seconds can only hold the five hard ones plus five easy: (5*500 + 5*100)/10.
    assert.equal(curve.get(10), 300);
    assert.equal(curve.get(30), Math.round(((5 * 500 + 25 * 100) / 30) * 10) / 10);
  });

  it('reports the same value at every duration for a constant effort', () => {
    const curve = computePowerCurve(Array(4000).fill(220));
    for (const [, watts] of curve) assert.equal(watts, 220);
  });

  it('leaves out durations longer than the ride', () => {
    const curve = computePowerCurve(Array(100).fill(200));

    assert.equal(curve.has(60), true);
    assert.equal(curve.has(300), false);
    assert.equal(curve.has(3600), false);
  });

  it('treats a gap in the stream as zero watts, because coasting really is zero', () => {
    const withGap = [...Array(5).fill(400), ...Array(5).fill(0)];
    const curve = computePowerCurve(withGap);

    assert.equal(curve.get(5), 400);
    assert.equal(curve.get(10), 200);
  });

  it('returns zeros rather than NaN for a ride of pure coasting', () => {
    const curve = computePowerCurve(Array(100).fill(0));

    assert.equal(curve.get(10), 0);
    assert.ok([...curve.values()].every(Number.isFinite));
  });
});

describe('toSecondStream', () => {
  it('passes a steady one-second recording through unchanged', () => {
    const samples = [100, 200, 300].map((watts, seconds) => ({ seconds, watts }));
    assert.deepEqual(toSecondStream(samples), [100, 200, 300]);
  });

  it('holds each reading for one interval on a slower recording', () => {
    const samples = [300, 100].map((watts, i) => ({ seconds: i * 2, watts }));
    assert.deepEqual(toSecondStream(samples, 2), [300, 300, 100, 100]);
  });

  /**
   * The defect behind ride #22736415876: it opened with a 26-second pause, and the
   * old parser took that first gap as the sample rate for the whole ride, so a
   * one-minute window covered two samples. A gap is time, and only time.
   */
  it('turns a long gap into zero watts instead of stretching the reading across it', () => {
    const samples = [
      { seconds: 0, watts: 400 },
      { seconds: 26, watts: 200 },
      { seconds: 27, watts: 200 },
    ];
    const stream = toSecondStream(samples);

    assert.equal(stream.length, 28);
    assert.equal(stream.filter((w) => w === 400).length, 1);
    assert.equal(stream.filter((w) => w === 0).length, 25);
    assert.equal(toSecondStream(samples, 2).filter((w) => w === 400).length, 2);
  });

  it('returns nothing for no samples', () => {
    assert.deepEqual(toSecondStream([]), []);
  });
});

describe('extractFitFromZip', () => {
  const payload = Buffer.from('.FIT'.repeat(500), 'ascii');

  it('reads a conventional deflated archive', () => {
    const out = extractFitFromZip(makeZip('1_ACTIVITY.fit', payload));
    assert.deepEqual(out, payload);
  });

  /**
   * The regression that cost 135 downloads: Garmin streams the archive, so the local
   * file header reports a compressed size of zero. Reading it yields an empty slice
   * and inflate fails with "unexpected end of file". The central directory has the
   * real size.
   */
  it('reads a streamed archive whose local header claims a zero size', () => {
    const zip = makeZip('1_ACTIVITY.fit', payload, { streaming: true });

    assert.equal(zip.readUInt32LE(18), 0, 'fixture should reproduce the zero local size');
    assert.deepEqual(extractFitFromZip(zip), payload);
  });

  it('reads an uncompressed entry', () => {
    const out = extractFitFromZip(makeZip('1_ACTIVITY.fit', payload, { method: 0 }));
    assert.deepEqual(out, payload);
  });

  it('refuses something that is not a ZIP', () => {
    assert.throws(() => extractFitFromZip(Buffer.from('not a zip at all')), /Not a ZIP archive/);
  });

  it('refuses an archive whose central directory is missing', () => {
    const zip = makeZip('1_ACTIVITY.fit', payload);
    assert.throws(() => extractFitFromZip(zip.subarray(0, zip.length - 22)), /end-of-central/);
  });
});

describe('parseFit', () => {
  it('reads records, power coverage and sample rate from a real FIT file', () => {
    const parsed = parseFit(makeFit([...Array(100).fill(250), ...Array(20).fill(null)]));

    assert.equal(parsed.recordCount, 120);
    assert.equal(parsed.powerRecords, 100);
    assert.equal(parsed.sampleRateSeconds, 1);
    assert.equal(parsed.powerCurve.get(60), 250);
  });

  it('derives the curve from the file, matching a hand-computed peak', () => {
    const power = [...Array(60).fill(150), ...Array(60).fill(350), ...Array(60).fill(150)];
    const parsed = parseFit(makeFit(power));

    assert.equal(parsed.powerCurve.get(60), 350);
    assert.equal(parsed.powerCurve.get(120), 250);
    assert.deepEqual(parsed.powerCurve.get(60), computePowerCurve(power).get(60));
  });

  it('detects a slower sample rate and sizes the windows to it', () => {
    const parsed = parseFit(Buffer.from(makeFit(Array(60).fill(200), 2)));

    assert.equal(parsed.sampleRateSeconds, 2);
    assert.equal(parsed.powerCurve.get(120), 200);
  });

  it('measures windows in seconds when the ride opens with a pause', () => {
    // One sample, a 26-second pause, then ten minutes at 200 W. Read as a 26-second
    // sample rate, the old parser made every minute window two samples wide.
    const power = [800, ...Array(600).fill(200)];
    const offsets = [0, ...Array.from({ length: 600 }, (_, i) => 26 + i)];
    const parsed = parseFit(makeFit(power, 1, offsets));

    assert.equal(parsed.sampleRateSeconds, 1);
    assert.equal(parsed.powerCurve.get(60), 200);
    assert.equal(parsed.powerCurve.get(300), 200);
  });

  it('does not close up a recording gap in the middle of a ride', () => {
    // Two minutes at 300 W either side of a five-minute stop. Counting samples
    // would join them into four unbroken minutes.
    const power = [...Array(120).fill(300), ...Array(120).fill(300)];
    const offsets = [
      ...Array.from({ length: 120 }, (_, i) => i),
      ...Array.from({ length: 120 }, (_, i) => 420 + i),
    ];
    const parsed = parseFit(makeFit(power, 1, offsets));

    assert.equal(parsed.powerCurve.get(120), 300);
    assert.ok((parsed.powerCurve.get(300) ?? Infinity) < 300);
  });

  it('gives an empty curve, not zeros, for a ride with no power meter', () => {
    const parsed = parseFit(makeFit(Array(100).fill(null)));

    assert.equal(parsed.recordCount, 100);
    assert.equal(parsed.powerRecords, 0);
    assert.equal(parsed.powerCurve.size, 0);
  });

  it('refuses a buffer that is not a FIT file', () => {
    assert.throws(() => parseFit(Buffer.alloc(200)), /Not a FIT file/);
  });

  it('only ever reports the durations it is configured for', () => {
    const parsed = parseFit(makeFit(Array(500).fill(200)));

    for (const duration of parsed.powerCurve.keys()) {
      assert.ok(
        (POWER_CURVE_DURATIONS as readonly number[]).includes(duration),
        `unexpected duration ${duration}`,
      );
    }
  });
});
