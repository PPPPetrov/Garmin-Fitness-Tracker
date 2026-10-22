# Ride detail — design

Date: 22 October 2026
Status: approved in conversation, not yet planned or built.

## The gap this closes

The Activities screen lists 423 rides and dead-ends there. `GET /api/activities/:id` already
returns a ride, its power curve and its FIT state, and no line of the interface calls it.

Underneath, a larger gap: FIT files are downloaded only for rides with a power meter. That is
135 of 423. The other 288 are mountain biking — 58 % of the riding and the main sport — and for
those the tracker holds nothing but Garmin's summary. The FIT file carries a GPS track, altitude,
heart rate and cadence, all of which a mountain-bike ride has.

## The question the screen answers

**How hard was this ride?** Time in zones, the peaks inside it, and what it did to the load
curve. Route and climbing profile are the second layer, not the headline.

## Decisions taken

| Decision | Choice |
| --- | --- |
| Which rides get a FIT file | All of them, gradually: new rides on every sync, the last 365 days now, older history on an explicit command |
| Map | The track alone, drawn as SVG. No basemap, no tile server — the privacy claim in the README stays true |
| What the screen leads with | Effort: zones, peaks, contribution to load |
| What is stored | Hybrid: exact summaries computed from the full 1 Hz stream, plus a downsampled stream kept only for drawing |
| Where it lives | Its own address, `#ride/<id>`, reachable from the Activities list |

## What the data allows

| Fact | Consequence |
| --- | --- |
| FIT records carry `power`, `heartRate`, `cadence`, `speed`, `distance`, `altitude`, `positionLat/Long` at 1 Hz | Every channel the screen needs is in the file already |
| `functionalThresholdPower` is on each powered activity | Power zones are correct per ride without a history table |
| Garmin returns **current** heart-rate zones only | Heart-rate zones for an old ride are today's zones unless we date them |
| 18 rides were recorded without a heart-rate strap | They get no heart-rate zones, and the screen repeats the warning the list already gives |
| 61 rides are indoor | No track. The band is absent rather than empty |
| Position is in semicircles | `degrees = semicircles × 180 / 2^31` |

## Storage

Three new tables. Each one has a single job, and the existing `power_curve` is reused unchanged.

```sql
-- Downsampled stream, kept for drawing only. One row per ride.
-- Each channel is a JSON array of numbers and nulls, all of the same length.
-- Time of point i is i * sample_s; no timestamp column is needed.
-- A channel absent from the file is NULL for the whole ride, never an array of zeros.
-- A gap inside a present channel is null at its own index.
CREATE TABLE IF NOT EXISTS activity_stream (
  activity_id INTEGER PRIMARY KEY REFERENCES activity(activity_id) ON DELETE CASCADE,
  sample_s    INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  -- The first record's own timestamp, which is not always the activity's start:
  -- a device left recording before the ride begins shifts one against the other.
  started_at  TEXT    NOT NULL,
  power       TEXT, heart_rate TEXT, cadence  TEXT, altitude_m TEXT,
  speed_mps   TEXT, distance_m TEXT, lat      TEXT, lon        TEXT,
  parsed_at   TEXT    NOT NULL
);

-- Seconds in each zone, computed from the FULL 1 Hz stream before downsampling.
-- Zones are numbered from 1 upwards: 1-7 for power, 1-5 for heart rate.
CREATE TABLE IF NOT EXISTS activity_zone (
  activity_id INTEGER NOT NULL REFERENCES activity(activity_id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('hr','power')),
  zone        INTEGER NOT NULL,
  seconds     REAL    NOT NULL,
  PRIMARY KEY (activity_id, kind, zone)
);

-- Garmin's heart-rate zones as of a date. Garmin keeps no history, so we keep one.
-- boundaries is a JSON array of the lower bound of each zone in bpm, ascending,
-- one entry per zone: [z1_low, z2_low, z3_low, z4_low, z5_low].
CREATE TABLE IF NOT EXISTS hr_zone_set (
  fetched_at TEXT PRIMARY KEY,
  max_hr     INTEGER,
  resting_hr INTEGER,
  boundaries TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('garmin','estimated'))
);
```

`sample_s` is 5. An average two-hour ride is 1440 points; eight channels at roughly 8 KB each is
about 48 KB a ride, so the whole history costs **20–25 MB**. At five seconds the gap between
track points is about 14 m at mountain-bike speed and 42 m on the road, which is enough for the
shape of a loop. No simplification algorithm and no separate track table: if the line ever looks
angular, simplification is added then.

Schema changes go through the additive `migrate()` in `src/db/index.ts`, as `daily_load` did.

## Import

**Parsing.** `parseFit` currently reads power alone. It will return every channel above, and
produce three things: the power curve (unchanged), the zone seconds (from the full stream), and
the five-second downsample. The downsample takes the mean over each bucket for power, heart rate,
cadence, speed and altitude, the last value for distance, and the nearest sample for position. An
empty bucket stays null.

**Eligibility.** A ride needs a FIT file when it has **no row in `activity_stream`** — not by
`fit_file.status`. This pulls in the 135 already-parsed rides, from which only the curve was kept,
and the 288 marked `skipped` for having no power meter. `skipped` stops meaning "no power meter"
and comes to mean "Garmin has no file for this ride"; the 288 existing rows are not migrated, they
are simply attempted again and their status overwritten by the result. Nothing else reads that
column, so no backfill of its old meaning is needed.

**Commands.**

| Command | What it does |
| --- | --- |
| `npm run sync` | Activities as today, and now the FIT file for every new ride by default. `--no-fit` opts out |
| `npx tsx src/cli.ts backfill` | The last 365 days. `--since YYYY-MM-DD`, `--all`, `--limit N`. Resumable and idempotent |

The last 365 days hold about 170 rides, so the first backfill is about 170 requests and two
rate-limit pauses. `--all` is 423 requests and about five pauses. Files are parsed and discarded
as they are today; only the derived rows are kept.

**Zones.** Each sync re-reads `GET /biometric-service/heartRateZones/v2` and writes a new
`hr_zone_set` row when the boundaries differ from the latest one. A ride uses the newest set whose
`fetched_at` is not after its date; a ride older than every set uses the earliest and is flagged.
This mirrors how `ftp_at_ride` already works, and the history corrects itself going forward.

## The maths of effort

**Power zones** come from the ride's own `ftp_at_ride`, in seven bands — ≤55 %, 56–75 %, 76–90 %,
91–105 %, 106–120 %, 121–150 %, >150 % of threshold. FTP moved from 150 W to 250 W across these
four years, so a 2023 ride is measured against 2023's threshold. This is our calculation, not
Garmin's, and is labelled as ours wherever it appears.

**Heart-rate zones** come from the set in effect on the ride's date. If Garmin returns nothing —
plausible, since every wellness endpoint on this account does — the fallback is a set derived from
the highest heart rate seen in the trailing twelve months, at 50 %, 60 %, 70 %, 80 % and 90 % of
it, written with `source = 'estimated'`. The screen says which of the two it is showing. Never
silently.

**Which seconds count.** A second enters a zone only if it has a reading. The zone seconds
therefore sum to the seconds with a reading, which is less than the ride's duration. The screen
states the difference — "heart rate recorded for 1:58 of 2:04" — rather than stretching the bar
to fill the width.

**The leading number.** How hard the ride was is answered with the model that already exists: the
ride's training load against the average daily load over the preceding 42 days. A ride of 239
against an average of 67 is visibly hard without inventing a new scale. Beside it: time at and
above zone 4, and the best twenty minutes of power as a share of the threshold in effect then.

**Rides we cannot answer for.** No strap: no heart-rate zones, and the screen repeats what the
list already says about the load being untrustworthy. No power meter: no power zones. Indoor: no
track. In each case the band is absent, not a band full of zeros.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/activities/:id` | The ride, its power curve, its FIT state, its zone seconds with the boundaries and source used, whether that zone set postdates the ride, the `daily_load` row for that day, and flags for stream and track |
| `GET /api/activities/:id/stream` | `sample_s`, `points`, and the channels present |

Two endpoints rather than one, so the top of the screen draws without waiting for 50 KB. The
season's best power, which band 6 draws the ride's curve against, needs no new endpoint: the
existing `GET /api/power-curve?since=` already answers it.

## The screen

Address `#ride/<id>`. `currentView()` in `App.tsx` grows to recognise that form; "Activities"
stays marked in the navigation, because that is where the visitor came from, and the page opens
with a way back. The link is shareable and the browser's back button works.

Bands in the order the screen's question implies:

1. **Title** — name, long date, type, place, and one sentence saying how hard it was.
2. **Figures** — time, distance, climb, load, TSS and IF where there is power, average and maximum heart rate.
3. **Effort** — the zone bars, power above, heart rate below, each segment carrying its time and share. Unrecorded seconds sit at the end as a quiet remainder.
4. **The ride over time** — heart rate and power as lines, altitude as a filled backdrop. The x axis is time. By distance can follow later if it is wanted.
5. **Route** — the track as SVG, coloured by altitude, with start, finish and a scale bar. Absent indoors.
6. **This ride's power** — its curve over the season's best. Only where there is power.
7. **What cannot be seen** — which sensors were missing, the date of the zone set, and whether this ride's load can be trusted.

The Activities rows become doors: a real link in the name cell, so keyboard and middle-click work.

**States.** A skeleton for the top, a separate one for the stream band. An error is shown inside
its own band — if the stream fails, the figures above still stand.

**New components.** `charts/ZoneBar.tsx` and `charts/Track.tsx`. For the time series, `Line.tsx`
is used if its props take a general series; if it is bound to the daily shape, `charts/Stream.tsx`
is added. Each chart file keeps one job, as the existing ones do.

On a phone the zone bars stack, the time series keeps the full width, and the route becomes a
square.

## When something breaks

| Failure | Behaviour |
| --- | --- |
| HTTP 429 during backfill | The existing throttle listener waits out `retryInSeconds` and continues |
| Garmin has no file for a ride | `fit_file.status = 'skipped'`, the reason in its `error` column; the screen falls back to the summary |
| Corrupt FIT or failed integrity check | `fit_file.status = 'failed'` with the message; the backfill carries on; the screen says the file could not be read |
| Zones endpoint empty | An `estimated` set is written and every zone reading on screen is marked as ours |
| Ride with neither heart rate nor power | No effort band at all, and the honesty band says why |

## What the tests pin down

In the style of the existing 29, under `node:test`.

1. Zone seconds sum to the count of valid samples, including on a stream with gaps.
2. A sample exactly on a boundary falls in the higher zone, and is counted once.
3. An old ride is scored against its own FTP: the same watts land in different zones at FTP 150
   and at FTP 250.
4. The zone set chosen is the newest one not after the ride's date; a ride older than all of them
   uses the earliest and is flagged.
5. Downsampling preserves total distance and duration within tolerance, and keeps nulls as nulls
   rather than zeros.
6. Semicircles convert to degrees against a known point.
7. A second backfill run downloads nothing and changes no row.

## The shape of the work

Two stages, in this order, because the second cannot be seen until the first has run:

1. **The pipeline** — schema, the widened parser, zones, the downsample, the backfill command,
   and the tests that pin all of it. Done when `backfill` has filled a year of history and
   `stats` can report how many rides have a stream.
2. **The screen** — the two endpoints, the route, the bands and the chart components. Done when
   a ride opened from the list answers how hard it was, and says what it cannot see.

## To verify before building

- **Does `GET /biometric-service/heartRateZones/v2` return anything for this account?** Every
  wellness endpoint returns empty. One request settles it, and the answer decides whether the
  estimated fallback is the normal path or the rare one.
- **Does a mountain-bike ride's FIT file actually contain position and altitude?** Only powered
  rides have been parsed so far. One download settles it.
- **The measured size of one parsed ride in the database**, against the 48 KB estimate above.

## Out of scope

Basemap tiles of any kind. Segment or route matching between rides. Re-deriving training load
from power. Editing or annotating rides. Lap and interval detection — the FIT lap messages are
there, but nothing on this screen needs them yet.
