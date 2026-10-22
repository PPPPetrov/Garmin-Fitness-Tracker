# Ride Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every ride its own screen, led by how hard it was, and fill the data behind it by downloading a FIT file for every ride rather than only the third that have a power meter.

**Architecture:** FIT parsing widens from power alone to every channel in the file. Accuracy-sensitive numbers — seconds in each heart-rate and power zone — are computed from the full 1 Hz samples at parse time and stored as rows; a five-second downsample of the same samples is stored separately and used only for drawing. Two endpoints serve the screen: a small summary and a larger stream, so the top of the page draws without waiting for the charts.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Hono, better-sqlite3, `@garmin/fitsdk`, Vite + React 18, `node:test` via `tsx`.

**Spec:** [`docs/superpowers/specs/2026-10-22-ride-detail-design.md`](../specs/2026-10-22-ride-detail-design.md)

## Global Constraints

- Node 22 or newer. TypeScript throughout, ESM, imports carry the `.js` extension.
- Tests are `node:test`, run by `npm test` (`tsx --test src/**/*.test.ts`). **Only `src/` is covered. `web/` has no test runner and this plan does not add one** — web tasks are verified by `npm run typecheck` plus the named visual check in their last step.
- Functions that write to the database take a `Database` as their first parameter, so tests can pass `openDatabase(':memory:')` as `src/calc/load.test.ts` already does. Callers pass `db()`.
- A missing sensor renders as missing, never as zero. A dash is not a value.
- Our calculations are labelled as ours; Garmin's numbers as Garmin's.
- Today's FTP or today's zones are never applied to an old ride without the screen saying so.
- `sample_s` is 5.
- Power zones, as a share of the ride's own FTP: zone 1 ≤55 %, 2 to 75 %, 3 to 90 %, 4 to 105 %, 5 to 120 %, 6 to 150 %, 7 above. Zones are numbered from 1.
- Estimated heart-rate zones: 50 %, 60 %, 70 %, 80 %, 90 % of the highest heart rate in the trailing twelve months.
- A value exactly on a zone boundary belongs to the higher zone, and is counted once.
- Schema changes go in `src/db/schema.sql`; columns added to existing tables go through `migrate()` in `src/db/index.ts`.
- Commit messages follow the repository's style: a sentence-case imperative subject, no `feat:` prefix. Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- The interface follows `docs/interface.md`: existing tokens (`--chart-1`, `--chart-2`, `--chart-3`, `--chart-grey`, `--accent`) and existing classes (`band`, `band-head`, `band-title`, `band-desc`, `kpi-row`, `title-row`, `finding`, `fig`, `sub`, `dash`, `state`, `skeleton`). No new colour is introduced.

## Review Focus

1. **A FIT file recorded with smart recording, not 1 Hz.** Samples arrive at irregular intervals; bucketing by record index instead of elapsed time silently compresses or stretches the ride. Covered by a test in Task 3.
2. **A GPS dropout inside a ride.** Null positions must break the track, not draw a straight line across the gap. Covered by tests in Tasks 5 and 13.
3. **A ride with `avg_power` but no `ftp_at_ride`.** Power zones cannot be computed; the band must be absent rather than dividing by null. Covered by a test in Task 4.
4. **A ride parsed twice.** The second parse must replace that ride's zone rows, not add to them, or the seconds double. Covered by a test in Task 7.
5. **A ride with neither heart rate nor power.** Zone shares divide by zero seconds; the effort band must be absent and nothing may render `NaN`. Covered by tests in Tasks 4 and 11.

---

### Task 1: Verify what Garmin actually returns

The spec rests on two unknowns. One request each settles them, and the answer decides whether the estimated zone fallback is the normal path or the rare one.

**Files:**
- Modify: `docs/data-inventory.md` (append a section)
- Throwaway: a script under the scratchpad directory, not committed

**Interfaces:**
- Consumes: `getHeartRateZones()` and `downloadActivityFile(id)` from `src/garmin/client.js`, both already written
- Produces: a recorded answer the later tasks read from `docs/data-inventory.md`

- [ ] **Step 1: Write a one-off script in the scratchpad** that calls `getHeartRateZones()`, prints the raw response, then picks one `mountain_biking` activity id from the database, downloads it with `downloadActivityFile`, extracts it with `extractFitFromZip`, and prints which of `heartRate`, `altitude`, `positionLat`, `positionLong`, `cadence`, `speed`, `distance` are present on its records and the interval between the first two timestamps.

- [ ] **Step 2: Run it**

Run: `npx tsx <scratchpad>/probe.ts`
Expected: either the zone payload or an empty response, and a field list for the mountain-bike ride.

- [ ] **Step 3: Record the answers in `docs/data-inventory.md`** under a new `### Heart-rate zones and non-powered FIT files` heading, in the measured style the rest of that document uses: the exact response shape or the word empty, the field list, and the sample interval.

- [ ] **Step 4: Commit**

```bash
git add docs/data-inventory.md
git commit -m "Record what the zones endpoint and a mountain-bike FIT file return"
```

---

### Task 2: Schema for streams, zones and zone sets

**Files:**
- Modify: `src/db/schema.sql`
- Test: `src/db/schema.test.ts` (create)

**Interfaces:**
- Produces: tables `activity_stream`, `activity_zone`, `hr_zone_set` exactly as written in the spec's Storage section. Copy the three `CREATE TABLE` statements and their comments from the spec verbatim.

- [ ] **Step 1: Write the failing test** in `src/db/schema.test.ts`

```ts
describe('schema', () => {
  it('creates the ride detail tables', () => {
    const database = openDatabase(':memory:');
    const names = new Set(
      (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
        { name: string }[]).map((r) => r.name),
    );
    for (const table of ['activity_stream', 'activity_zone', 'hr_zone_set']) {
      assert.ok(names.has(table), table);
    }
    database.close();
  });

  it('rejects a zone kind it does not know', () => {
    // insert into activity_zone with kind 'speed' → assert.throws
  });

  it('drops a ride\'s stream and zones with the ride', () => {
    // insert an activity, a stream row and a zone row, DELETE the activity,
    // assert both child tables are empty — PRAGMA foreign_keys is already ON
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/db/schema.test.ts`
Expected: FAIL — no such table: activity_stream

- [ ] **Step 3: Add the three tables to `src/db/schema.sql`**

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/schema.test.ts
git commit -m "Add tables for ride streams, zone seconds and zone sets"
```

---

### Task 3: Downsampling and coordinates

**Files:**
- Create: `src/calc/stream.ts`
- Test: `src/calc/stream.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Sample {
  elapsed_s: number;
  power: number | null; heart_rate: number | null; cadence: number | null;
  altitude_m: number | null; speed_mps: number | null; distance_m: number | null;
  lat: number | null; lon: number | null;
}
export type Channel = Exclude<keyof Sample, 'elapsed_s'>;
export interface Downsampled {
  sample_s: number;
  points: number;
  channels: Partial<Record<Channel, (number | null)[]>>;
}
export function downsample(samples: Sample[], sampleSeconds: number): Downsampled;
export function semicirclesToDegrees(value: number): number;
```
A channel absent from every sample is absent from `channels`, not an array of nulls. Buckets are taken on `elapsed_s`, so bucket `i` covers `[i * sampleSeconds, (i + 1) * sampleSeconds)`. Power, heart rate, cadence, speed and altitude take the mean of their bucket; distance takes the last value in it; latitude and longitude take the sample nearest the bucket's start. An empty bucket is null in every channel.

- [ ] **Step 1: Write the failing tests** in `src/calc/stream.test.ts`

```ts
describe('downsample', () => {
  it('buckets by elapsed time, not by record count', () => {
    // 60 samples at 10 s intervals (smart recording) → 600 s of ride
    // assert.equal(result.points, 120)   // 600 / 5
  });
  it('keeps the last distance in each bucket', () => { /* monotonic distance preserved at bucket ends */ });
  it('leaves a channel absent when no sample carries it', () => {
    // assert.equal('power' in result.channels, false)
  });
  it('keeps a gap inside a channel as null, not zero', () => { /* null at its own index */ });
  it('gives one point for a ride shorter than one bucket', () => {
    // 3 samples over 2 s → assert.equal(result.points, 1)
  });
});

describe('semicirclesToDegrees', () => {
  it('converts a known point', () => {
    assert.ok(Math.abs(semicirclesToDegrees(500_000_000) - 41.9095159) < 1e-6);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/calc/stream.test.ts`
Expected: FAIL — cannot find module './stream.js'

- [ ] **Step 3: Implement `downsample` and `semicirclesToDegrees` in `src/calc/stream.ts`**

`semicirclesToDegrees` is `value * 180 / 2 ** 31`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/calc/stream.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calc/stream.ts src/calc/stream.test.ts
git commit -m "Downsample ride samples to a fixed cadence for drawing"
```

---

### Task 4: Zone maths

**Files:**
- Create: `src/calc/zones.ts`
- Test: `src/calc/zones.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
```ts
export const POWER_ZONE_SHARES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;
export const ESTIMATED_HR_SHARES = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
export interface HrZoneSet {
  fetched_at: string;
  boundaries: number[];
  source: 'garmin' | 'estimated';
  max_hr: number | null;
}
/** Lower bound of each zone in watts: zone 1 starts at 0. Null FTP has no zones. */
export function powerZoneBoundaries(ftp: number | null): number[] | null;
export function estimatedHrBoundaries(maxHr: number): number[];
/** Seconds in each zone; index i is zone i + 1. Nulls are not counted. */
export function zoneSeconds(
  values: (number | null)[], lowerBounds: number[], sampleSeconds: number,
): number[];
export function zoneSetFor(
  rideDate: string, sets: HrZoneSet[],
): { set: HrZoneSet; postdatesRide: boolean } | null;
```

- [ ] **Step 1: Write the failing tests** in `src/calc/zones.test.ts`

```ts
describe('zoneSeconds', () => {
  it('counts only seconds that have a reading', () => {
    const seconds = zoneSeconds([100, null, 100, null], [0, 50], 1);
    assert.equal(seconds.reduce((a, b) => a + b, 0), 2);
  });
  it('puts a value exactly on a boundary in the higher zone, once', () => {
    assert.deepEqual(zoneSeconds([50], [0, 50], 1), [0, 1]);
  });
  it('returns zeros, not NaN, when every value is null', () => {
    assert.deepEqual(zoneSeconds([null, null], [0, 50], 1), [0, 0]);
  });
});

describe('powerZoneBoundaries', () => {
  it('scores a ride against its own FTP', () => {
    // 170 W at FTP 150 is zone 5; the same 170 W at FTP 250 is zone 2
    assert.deepEqual(zoneSeconds([170], powerZoneBoundaries(150)!, 1), [0, 0, 0, 0, 1, 0, 0]);
    assert.deepEqual(zoneSeconds([170], powerZoneBoundaries(250)!, 1), [0, 1, 0, 0, 0, 0, 0]);
  });
  it('has no zones without an FTP', () => {
    assert.equal(powerZoneBoundaries(null), null);
  });
});

describe('zoneSetFor', () => {
  it('takes the newest set that is not after the ride', () => { /* three sets, middle one wins */ });
  it('flags a ride older than every set', () => {
    // assert.equal(result.postdatesRide, true) and the earliest set is returned
  });
  it('returns null when there are no sets at all', () => { /* assert.equal(result, null) */ });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/calc/zones.test.ts`
Expected: FAIL — cannot find module './zones.js'

- [ ] **Step 3: Implement the five exports in `src/calc/zones.ts`**

`powerZoneBoundaries` maps `POWER_ZONE_SHARES` over the FTP and prefixes 0, giving seven lower bounds. `zoneSeconds` finds, for each value, the highest index whose lower bound the value is greater than or equal to.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/calc/zones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calc/zones.ts src/calc/zones.test.ts
git commit -m "Compute seconds in heart-rate and power zones"
```

---

### Task 5: Widen the FIT parser to every channel

**Files:**
- Modify: `src/sync/fit.ts` (the `FitRecord` interface, `ParsedFit`, `parseFit`)
- Modify: `src/sync/fit.test.ts` (extend; its `makeFit` encoder fixture already exists)

**Interfaces:**
- Consumes: `Sample`, `semicirclesToDegrees` from `src/calc/stream.js`
- Produces: `ParsedFit` gains `samples: Sample[]`. `recordCount`, `powerRecords`, `sampleRateSeconds` and `powerCurve` keep their current meaning and type. `parseFit` stays pure: it reads a file and returns numbers, and knows nothing about FTP, zones or the database.

- [ ] **Step 1: Write the failing tests** in `src/sync/fit.test.ts`, inside the existing `describe('parseFit')`

```ts
it('reads every channel the record carries', () => {
  // encode records with heartRate, cadence, altitude, speed, distance
  // assert the first sample's fields against the encoded values
});
it('converts position to degrees', () => {
  // positionLat 500_000_000 → assert.ok(Math.abs(samples[0].lat! - 41.9095159) < 1e-6)
});
it('leaves a record without position as null, not zero', () => {
  // one record with no positionLat/Long → assert.equal(samples[1].lat, null)
});
it('measures elapsed seconds from the first record', () => {
  // assert.equal(samples[0].elapsed_s, 0) and the last against the encoded span
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/sync/fit.test.ts`
Expected: FAIL — samples is undefined

- [ ] **Step 3: Widen `FitRecord` and `parseFit` in `src/sync/fit.ts`** to collect `Sample[]`, converting positions with `semicirclesToDegrees` and leaving every absent field null.

- [ ] **Step 4: Run the full suite to verify nothing else moved**

Run: `npm test`
Expected: PASS, including the 29 tests that already existed

- [ ] **Step 5: Commit**

```bash
git add src/sync/fit.ts src/sync/fit.test.ts
git commit -m "Read heart rate, cadence, altitude, speed and position from FIT files"
```

---

### Task 6: Heart-rate zone sets

**Files:**
- Create: `src/sync/zones.ts`
- Test: `src/sync/zones.test.ts`

**Interfaces:**
- Consumes: `getHeartRateZones()` from `src/garmin/client.js`; `HrZoneSet`, `estimatedHrBoundaries` from `src/calc/zones.js`
- Produces:
```ts
export function readHrZoneSets(database: Database): HrZoneSet[];   // newest first
export function writeHrZoneSet(database: Database, set: HrZoneSet): boolean;  // false when identical to the newest
export function estimateFromHistory(database: Database, asOf: string): HrZoneSet | null;
export async function refreshHrZoneSet(database: Database): Promise<{ written: boolean; source: 'garmin' | 'estimated' }>;
```
`estimateFromHistory` reads `MAX(max_hr)` over activities in the twelve months before `asOf` and returns a set with `source: 'estimated'`; it returns null when the history holds no maximum heart rate at all. `refreshHrZoneSet` tries Garmin first and falls back to the estimate. **Parse Garmin's response according to the shape Task 1 recorded in `docs/data-inventory.md`.**

- [ ] **Step 1: Write the failing tests** in `src/sync/zones.test.ts`, using `openDatabase(':memory:')`

```ts
describe('hr zone sets', () => {
  it('writes a set when the boundaries differ from the newest', () => { /* assert.equal(written, true) */ });
  it('writes nothing when they are identical', () => { /* second call → assert.equal(written, false) */ });
  it('estimates from the highest heart rate of the last twelve months', () => {
    // activities with max_hr 150 (14 months ago) and 180 (2 months ago)
    // assert.deepEqual(set!.boundaries, estimatedHrBoundaries(180))
  });
  it('estimates nothing when no ride recorded a heart rate', () => { /* assert.equal(set, null) */ });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/sync/zones.test.ts`
Expected: FAIL — cannot find module './zones.js'

- [ ] **Step 3: Implement the four exports in `src/sync/zones.ts`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/sync/zones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/zones.ts src/sync/zones.test.ts
git commit -m "Keep dated heart-rate zone sets, with an estimate when Garmin has none"
```

---

### Task 7: Store a ride's stream and zones

**Files:**
- Create: `src/sync/streams.ts`
- Test: `src/sync/streams.test.ts`

**Interfaces:**
- Consumes: `Downsampled`, `downsample` from `src/calc/stream.js`; `zoneSeconds`, `powerZoneBoundaries`, `zoneSetFor` from `src/calc/zones.js`; `readHrZoneSets` from `src/sync/zones.js`; `ParsedFit` from `src/sync/fit.js`
- Produces:
```ts
export function storeRideStream(
  database: Database, activityId: number, parsed: ParsedFit,
): { points: number; hrZones: number; powerZones: number };
export function ridesNeedingStream(database: Database, since?: string, limit?: number): number[];
```
`storeRideStream` runs in one transaction: it deletes the ride's existing `activity_zone` rows, writes the zone seconds for whichever of heart rate and power the ride has, and upserts the single `activity_stream` row with each present channel as a JSON array. It reads the ride's `ftp_at_ride` and `local_date` from `activity`. `ridesNeedingStream` returns activity ids with **no `activity_stream` row**, newest first, optionally on or after `since`.

- [ ] **Step 1: Write the failing tests** in `src/sync/streams.test.ts`

```ts
describe('storeRideStream', () => {
  it('replaces a ride\'s zones when it is parsed twice', () => {
    // store the same parse twice
    // assert the zone seconds equal one ride's worth, not two
  });
  it('writes no power zones for a ride without an FTP', () => {
    // assert.equal(result.powerZones, 0) and no kind='power' rows
  });
  it('stores only the channels the ride has', () => {
    // a mountain-bike parse → power column is NULL, heart_rate is a JSON array
  });
});

describe('ridesNeedingStream', () => {
  it('returns rides with no stream row, newest first', () => { /* two of three rides */ });
  it('is empty once every ride has one', () => { /* assert.deepEqual(ids, []) */ });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/sync/streams.test.ts`
Expected: FAIL — cannot find module './streams.js'

- [ ] **Step 3: Implement both exports in `src/sync/streams.ts`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/sync/streams.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/streams.ts src/sync/streams.test.ts
git commit -m "Store a ride's downsampled stream and its zone seconds"
```

---

### Task 8: Backfill every ride, not only the powered ones

**Files:**
- Modify: `src/sync/fit.ts` (`syncFitFiles`)
- Modify: `src/cli.ts` (a `backfill` command, `--no-fit` on `sync`, a line in `commandStats`)
- Modify: `package.json` (a `backfill` script)
- Test: `src/sync/fit.test.ts` (extend)

**Interfaces:**
- Consumes: `ridesNeedingStream`, `storeRideStream` from `src/sync/streams.js`; `refreshHrZoneSet` from `src/sync/zones.js`
- Produces: `syncFitFiles(options: { onProgress?; keepFiles?; since?: string; limit?: number })` picks its work from `ridesNeedingStream` instead of filtering on `avg_power`, and calls `storeRideStream` after each successful parse. `FitSyncResult` keeps its three counters; `skipped` now counts rides Garmin has no file for.

- [ ] **Step 1: Write the failing test** in `src/sync/fit.test.ts`

```ts
describe('fit sync eligibility', () => {
  it('offers every ride without a stream, powered or not', () => {
    // three activities: one powered with a stream row, one powered without, one mountain bike
    // assert.deepEqual(ridesNeedingStream(database), [mtbId, poweredWithoutId].sort(...))
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/sync/fit.test.ts`
Expected: FAIL — the powered-only filter still applies

- [ ] **Step 3: Rewrite the work selection in `syncFitFiles`** to use `ridesNeedingStream(database, options.since, options.limit)`, drop the `avg_power` filter and the blanket `skipped` marking, and call `storeRideStream` inside the existing transaction after the power curve is written. Mark `skipped` only when Garmin answers that it has no file.

- [ ] **Step 4: Add the `backfill` command to `src/cli.ts`**

`npx tsx src/cli.ts backfill [--since YYYY-MM-DD] [--all] [--limit N]`, defaulting to the last 365 days. It calls `refreshHrZoneSet` once, then `syncFitFiles`, logging progress through the existing `log`, and ends by reporting how many rides now have a stream. Add `--no-fit` to `commandSync` so `sync` fetches FIT files for new rides by default, and add a line to `commandStats` reading `rides with a stream: N of M`. Add `"backfill": "tsx src/cli.ts backfill"` to the scripts in `package.json`, and update the usage text in the `default` branch.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run the real thing on a small slice, and measure what it cost**

Run: `npx tsx src/cli.ts backfill --limit 3`
Expected: three rides downloaded and parsed, and running it again downloads nothing.

Then measure one stored ride against the spec's 48 KB estimate — the third of its "To verify
before building" items:

```sql
SELECT activity_id, points,
       LENGTH(COALESCE(power,'')) + LENGTH(COALESCE(heart_rate,'')) + LENGTH(COALESCE(cadence,''))
     + LENGTH(COALESCE(altitude_m,'')) + LENGTH(COALESCE(speed_mps,'')) + LENGTH(COALESCE(distance_m,''))
     + LENGTH(COALESCE(lat,'')) + LENGTH(COALESCE(lon,'')) AS bytes
  FROM activity_stream;
```

Record the figure in `docs/data-inventory.md` beside Task 1's findings. If a ride costs far more
than 48 KB, say so in the commit message rather than changing the design here — 423 times the
measured figure is the number that matters, and the decision about it is the user's.

- [ ] **Step 7: Commit**

```bash
git add src/sync/fit.ts src/cli.ts src/sync/fit.test.ts package.json
git commit -m "Download a FIT file for every ride, resumable and incremental"
```

---

### Task 9: Serve the ride

**Files:**
- Modify: `src/server.ts`
- Test: none — the endpoints are thin queries over tables the earlier tasks test; the typecheck and the manual check below cover them

**Interfaces:**
- Consumes: `zoneSetFor`, `powerZoneBoundaries` from `src/calc/zones.js`; `readHrZoneSets` from `src/sync/zones.js`
- Produces:
```
GET /api/activities/:id    { activity, powerCurve, fit, day, zones, has }
  zones: { hr:    { seconds: number[]; boundaries: number[]; source: 'garmin'|'estimated'; postdatesRide: boolean } | null,
           power: { seconds: number[]; boundaries: number[] } | null,
           recordedSeconds: { hr: number|null; power: number|null } }
  day:  the daily_load row for the ride's local_date, or null
  has:  { stream: boolean; track: boolean }
GET /api/activities/:id/stream   { sample_s, points, channels }
```
`track` is true when the stream row has a non-null `lat`. The existing response keys `activity`, `powerCurve` and `fit` keep their current shapes.

- [ ] **Step 1: Extend `GET /api/activities/:id`** with `day`, `zones` and `has`, and add `GET /api/activities/:id/stream` returning the parsed JSON channels. A missing ride stays a 404; a ride with no stream row returns 404 on `/stream`.

- [ ] **Step 2: Check both by hand**

Run: `npm run server`, then in another shell `curl -s localhost:8787/api/activities/<id> | head -40` and `curl -s localhost:8787/api/activities/<id>/stream | head -5`
Expected: zone seconds that sum to at most the ride's duration, and a channel list matching the ride's sensors.

- [ ] **Step 3: Document both in `docs/api.md`** in the existing table-and-prose style.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts docs/api.md
git commit -m "Serve a ride's zones, day and stream"
```

---

### Task 10: The ride's address

**Files:**
- Create: `web/src/views/Ride.tsx`
- Modify: `web/src/App.tsx` (`currentView`, the view switch, the back link)
- Modify: `web/src/views/Activities.tsx` (the name cell becomes a link)
- Modify: `web/src/api.ts` (the response types for the two new endpoints)

**Interfaces:**
- Consumes: `useApi`, `Activity`, `LoadDay`, `PowerPoint` from `web/src/api.js`
- Produces: `RideDetail` and `RideStream` interfaces in `api.ts` mirroring Task 9's two responses; `Ride({ id }: { id: number })` in `views/Ride.tsx`

- [ ] **Step 1: Add `RideDetail` and `RideStream` to `web/src/api.ts`**, matching Task 9's shapes field for field.

- [ ] **Step 2: Teach `currentView()` the `#ride/<id>` form** in `App.tsx`, returning the id alongside the view. Keep `Activities` marked in the navigation while a ride is open, and render a back link to `#activities` above the title.

- [ ] **Step 3: Write `views/Ride.tsx`** with the title row and the figures row only: name, long date, type, place, then time, distance, climb, load, TSS and IF where there is power, average and maximum heart rate. Reuse `format.ts` helpers (`duration`, `km`, `watts`, `num`, `longDate`, `rideName`, `typeName`, `DASH`) and the `Failed` and `Loading` states the other views already use.

- [ ] **Step 4: Make the name cell in `Activities.tsx` an `<a href={'#ride/' + a.activity_id}>`**, so keyboard and middle-click work.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`, then `npm run dev` and click a ride from the list.
Expected: the ride's figures appear at `#ride/<id>`, the browser's back button returns to the list, and the figures match that row in the table.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/Ride.tsx web/src/App.tsx web/src/views/Activities.tsx web/src/api.ts
git commit -m "Open a ride from the list at its own address"
```

---

### Task 11: The effort band

**Files:**
- Create: `web/src/charts/ZoneBar.tsx`
- Modify: `web/src/views/Ride.tsx`

**Interfaces:**
- Produces: `ZoneBar({ seconds, boundaries, unit, colour }: { seconds: number[]; boundaries: number[]; unit: 'bpm' | 'W'; colour: string })` — a horizontal stacked bar, one segment per zone, each carrying its time and share, labelled with the zone number and its lower bound.

- [ ] **Step 1: Write `charts/ZoneBar.tsx`**

Segment widths are shares of the summed seconds. **When the sum is zero the component renders nothing** — never a bar of `NaN%` widths. Use `--chart-1` through `--chart-3` and `--chart-grey` at varying opacity rather than a new colour ramp, as `docs/interface.md` requires.

- [ ] **Step 2: Add the effort band to `Ride.tsx`** — power above, heart rate below, each present only when its zones are. Under the bars, the recorded time against the ride's duration in the house phrasing: `heart rate recorded for 1:58 of 2:04`. When neither set of zones exists, the band is absent and the honesty band in Task 14 explains why.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, then open a road ride, a mountain-bike ride and one of the 18 rides recorded without a strap.
Expected: two bars, one bar, and no band at all, respectively; no `NaN` anywhere; the segment times sum to the recorded time stated beneath.

- [ ] **Step 4: Commit**

```bash
git add web/src/charts/ZoneBar.tsx web/src/views/Ride.tsx
git commit -m "Show time in zones as the ride's leading band"
```

---

### Task 12: The ride over time

**Files:**
- Create: `web/src/charts/Stream.tsx`
- Modify: `web/src/views/Ride.tsx`

**Interfaces:**
- Produces: `StreamChart({ sampleS, channels, height }: { sampleS: number; channels: { heart_rate?: (number|null)[]; power?: (number|null)[]; altitude_m?: (number|null)[] }; height?: number })`

`LineChart` is not reused here: it puts every series on one scale, and heart rate in bpm, power in watts and altitude in metres on a shared axis is unreadable. `StreamChart` normalises each channel to its own range, draws altitude as a filled backdrop in `--chart-grey`, heart rate in `--chart-3` and power in `--chart-1`, and labels the axis for the channel the ride leads with — power where it exists, otherwise heart rate.

- [ ] **Step 1: Write `charts/Stream.tsx`**, reusing `useWidth` from `charts/useWidth.js` as the other charts do. A null breaks the path rather than drawing through it.

- [ ] **Step 2: Load the stream in `Ride.tsx`** from `/api/activities/:id/stream`, in its own `useApi` call so the figures above do not wait for it, with its own skeleton and its own error message inside the band.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, then open a long road ride and a ride with a sensor dropout.
Expected: three readable traces; the dropout leaves a gap rather than a straight line; the figures above render before the chart does.

- [ ] **Step 4: Commit**

```bash
git add web/src/charts/Stream.tsx web/src/views/Ride.tsx
git commit -m "Draw heart rate, power and altitude across the ride"
```

---

### Task 13: The route

**Files:**
- Create: `web/src/charts/Track.tsx`
- Modify: `web/src/views/Ride.tsx`

**Interfaces:**
- Produces: `Track({ lat, lon, altitude_m }: { lat: (number|null)[]; lon: (number|null)[]; altitude_m?: (number|null)[] })` — the prop names are the channel names, so the caller passes `channels` straight through

An equirectangular projection scaled by `cos(mean latitude)` keeps the shape honest without a projection library. The path is coloured by altitude where it is present, a single `--chart-1` where it is not, with start and finish marked and a scale bar in metres. **A null position breaks the path into a new segment** rather than joining across the gap. No basemap and no tile request: the spec's privacy claim depends on it.

- [ ] **Step 1: Write `charts/Track.tsx`**

- [ ] **Step 2: Add the route band to `Ride.tsx`**, absent entirely when `has.track` is false.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, then open a mountain-bike ride, a road ride and an indoor ride.
Expected: a recognisable loop, a recognisable route, and no band at all; a ride with a GPS dropout shows a broken line, not a straight dash across the map.

- [ ] **Step 4: Commit**

```bash
git add web/src/charts/Track.tsx web/src/views/Ride.tsx
git commit -m "Draw the ride's track without a basemap"
```

---

### Task 14: The verdict and what cannot be seen

**Files:**
- Modify: `web/src/views/Ride.tsx`

**Interfaces:**
- Consumes: `bestPowerCurve` through the existing `GET /api/power-curve?since=`; `day` from Task 9's response

- [ ] **Step 1: Write the leading sentence** in the title row, in the `finding` class the other screens use: the ride's training load against the average daily load of the preceding 42 days, then the time at and above zone 4, then the best twenty minutes of power as a share of the FTP in effect then. Each clause appears only when its data does.

- [ ] **Step 2: Add the power band** — this ride's curve over the season's best, fetched from `/api/power-curve?since=<1 January of the ride's year>`. Present only where the ride has power.

- [ ] **Step 3: Add the honesty band** — which sensors were missing and what that costs, the `fetched_at` of the zone set with a note when `postdatesRide` is true, whether this ride's load is trustworthy by the same rule `Activities.tsx` already applies in `unusableLoad`, and the FIT state when the file could not be read.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`, then open a strapless ride, a mountain-bike ride and a 2023 road ride.
Expected: the strapless ride says its load cannot be trusted; the mountain-bike ride has no power band; the 2023 ride says its heart-rate zones are dated later than the ride.

- [ ] **Step 5: Verify the whole screen on a phone**

At 390 px wide, open a road ride — the one case where every band is present at once.
Expected, as `docs/interface.md` requires: the zone bars stack rather than shrink, the time series
keeps the full width, the route is square, and nothing scrolls sideways.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/Ride.tsx
git commit -m "Say how hard the ride was, and what the screen cannot see"
```

---

### Task 15: Tell the documentation

The repository documents every table, every endpoint and every screen. Three documents now disagree with the code.

**Files:**
- Modify: `docs/data-model.md` (the three new tables, column by column, with why each exists)
- Modify: `docs/interface.md` (the ride screen, its bands and its states)
- Modify: `README.md` (the screen table gains a row; the importing section gains `npm run backfill`; "What it deliberately does not do" gains the absence of a basemap)
- `docs/api.md` was already updated in Task 9

- [ ] **Step 1: Update the three documents**

- [ ] **Step 2: Check the claims against the code** — every column named exists, every command runs, every figure quoted matches what `npm run stats` now prints.

- [ ] **Step 3: Commit**

```bash
git add docs/data-model.md docs/interface.md README.md
git commit -m "Document the ride screen, its tables and the backfill command"
```
