# Data model

One SQLite file, `data/garmin.db`, in WAL mode. The schema is
[`src/db/schema.sql`](../src/db/schema.sql), applied idempotently on every connection.

Six tables. Every one keeps enough provenance to trace a number on screen back to the ride and
the API response it came from.

```
activity ──┬── activity_raw   the untouched API responses
           ├── power_curve    peak mean power per duration
           └── fit_file       download and parse state

daily_load   one row per calendar day, recomputed wholesale
sync_run     one row per sync attempt
```

## `activity`

One row per Garmin activity, keyed on Garmin's own `activity_id`. This is what everything else
hangs off, and the reason re-running an import never duplicates.

### Identity and time

| Column | Notes |
| --- | --- |
| `activity_id` | Garmin's id. Primary key. |
| `activity_name` | Free text from Garmin. Zwift names carry a prefix every row shares, which the interface strips for display. |
| `activity_type` | `mountain_biking`, `road_biking`, `indoor_cycling`, `virtual_ride`, … |
| `start_time_local` | Garmin's own local wall clock. |
| `start_time_gmt` | The same instant in UTC. |
| `local_date` | **The day everything groups by.** Garmin's local calendar date, stored rather than derived, so a 23:40 ride never lands on the wrong day. |
| `time_zone` | As Garmin reported it. |

### Durations — all three of them

Garmin reports three durations and they disagree, so all three are kept rather than one being
picked:

| Column | What it is |
| --- | --- |
| `duration_s` | Garmin's ride time. What the dashboard shows and totals. |
| `moving_duration_s` | Excludes stops. |
| `elapsed_duration_s` | Wall clock from start to finish. |

### Measured fields

`distance_m`, `elevation_gain_m`, `elevation_loss_m`, `calories`, `avg_hr`, `max_hr`,
`avg_cadence`, `avg_temperature`.

### Power fields

`avg_power`, `max_power`, `normalized_power`, `max_power_20min`, `ftp_at_ride`,
`intensity_factor`, `training_stress_score`.

**All of these are `NULL` on a ride with no power meter.** They are not zero, and coalescing
them to zero would silently turn a hard mountain-bike ride into a very easy road ride. The
interface prints a grey dash for every one of them.

`ftp_at_ride` is Garmin's FTP estimate *as it stood on the day of the ride*, so a historical
intensity factor can be read back correctly.

### Load fields

| Column | Notes |
| --- | --- |
| `activity_training_load` | **The primary load series.** Present regardless of power meter, because it is EPOC-derived. Unreliable without a heart-rate strap — see [`load-model.md`](load-model.md). |
| `training_effect` | Garmin's aerobic training effect, 0–5. |
| `anaerobic_training_effect` | The anaerobic counterpart. |
| `training_effect_label` | Garmin's word for it, e.g. `TEMPO`. |

### Bookkeeping

`location_name`, `uploaded_at`, `last_updated_at`, `imported_at`, and `detail_fetched` — a
flag the import uses to know which rides still need their detail request.

Indexed on `local_date` and `activity_type`.

## `activity_raw`

The untouched JSON of both responses for each ride: `list_json`, `detail_json`, `fetched_at`.

This exists so that reprocessing never needs another round trip. Garmin's API is rate-limited
to 100 requests per window; working out a new derived field from fields already fetched should
cost nothing. Cascades on delete with `activity`.

## `power_curve`

Peak mean power per duration, parsed from the original `.fit` file. Primary key
`(activity_id, duration_s)`.

Thirteen durations: 1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600 and 5400 seconds.

Rows exist only for rides with a power meter — 135 of 423 here. A duration longer than the
ride has no row, rather than a row of zero. The all-time best at each duration is a `MAX` over
this table joined back to `activity` for the date.

## `fit_file`

Download and parse state, one row per ride, so an interrupted backfill resumes rather than
starting over.

| Column | Notes |
| --- | --- |
| `status` | `pending`, `downloaded`, `parsed`, `skipped` or `failed`. Enforced by a check constraint. |
| `byte_size`, `record_count`, `power_records` | What came out of the file. |
| `sample_rate_s` | Seconds between records. A ride recorded every 4 seconds needs a 75-sample window for 5 minutes, not 300. |
| `error` | Why it failed, when it did. |

`skipped` is the normal outcome for a ride with no power meter: there is nothing in the file
worth extracting.

## `daily_load`

The model's output, one row per calendar day, keyed on `local_date`. Recomputed wholesale by
`recomputeDailyLoad()` — at a few thousand days that is cheaper and far easier to reason about
than an incremental update.

| Column | Notes |
| --- | --- |
| `load_points` | Total training load that day, summed across rides. Zero on a rest day. |
| `ride_count` | Rides that day. |
| `fitness`, `fatigue`, `form` | The 42-day and 7-day EWMAs, and their difference lagged a day. |
| `is_warmup` | 1 inside the first 42 days of the history, where the curve has not settled. |
| `unmeasured_rides` | Rides **on this day** whose load the model cannot trust. |
| `is_estimated` | 1 when any day in the preceding 42 had an unmeasured ride, so this day's fitness is built on an incomplete window. |
| `formula_version` | `ewma-atl7-ctl42-v1`. Bumped whenever the maths changes. |
| `computed_at` | When the row was written. |

**There is a row for every day, including rest days.** A rest day is a zero, and the zeros are
what make the curves decay.

## `sync_run`

One row per sync attempt: `started_at`, `finished_at`, `mode` (`full` or `incremental`),
`activities_seen`, `activities_added`, `activities_updated`, `details_fetched`,
`fit_downloaded`, the coverage span, a `status` of `running` / `ok` / `failed`, and `error`.

`/api/status` returns the newest row, which is what the dashboard's freshness stamp is built
from.

## Migrations

`CREATE TABLE IF NOT EXISTS` never adds a column to a table that already exists, so new
columns go in two places: `schema.sql` for a fresh database, and the `migrate()` map in
[`src/db/index.ts`](../src/db/index.ts) for an existing one. `migrate()` reads
`PRAGMA table_info` and issues `ALTER TABLE ... ADD COLUMN` for anything missing.

`daily_load.unmeasured_rides` and `daily_load.is_estimated` were both added this way.
