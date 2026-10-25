# Local HTTP API

`src/server.ts`, a Hono app listening on `API_PORT` (8787 by default). Every response is JSON.

**There is no authentication.** The API reads a local file and exposes a sync trigger; it is
meant for `localhost` and must not be exposed beyond it. Vite proxies `/api` to this port in
development, so the browser only talks to one origin.

Dates are `YYYY-MM-DD` strings in Garmin's own local calendar (`local_date`). Timestamps are
ISO 8601 instants. A field that is `null` means the sensor or the value was absent — never
zero.

---

## `GET /api/status`

Coverage, data quality and sync state. The dashboard's top bar is built from this.

```json
{
  "coverage":      { "start": "2022-10-12", "end": "2026-10-21", "total": 423 },
  "fieldCoverage": { "total": 423, "withLoad": 381, "withTss": 132, "unreliableLoad": 53 },
  "lastSync":      { "finished_at": "2026-10-22T05:03:40.450Z", "status": "ok", "...": "..." },
  "syncing":       false,
  "timeZone":      "Europe/Athens"
}
```

| Field | Meaning |
| --- | --- |
| `coverage` | First and last ride, and how many there are. |
| `fieldCoverage.withLoad` | Rides where `activity_training_load` is not null. |
| `fieldCoverage.withTss` | Rides with a power-derived training stress score. |
| `fieldCoverage.unreliableLoad` | Rides the model cannot trust: no load at all, **or** no heart-rate strap on a ride over ten minutes. The two groups do not overlap in the count, so `total − unreliableLoad` is the number of trustworthy rides. |
| `lastSync` | The most recent `sync_run` row, or `null`. |
| `syncing` | Whether a sync started through this server is still running. |

---

## `POST /api/sync`

Starts an incremental sync in-process, then recomputes the load model. Returns immediately;
it does not wait for the import to finish.

- `200 { "started": true }`
- `409 { "started": false, "reason": "A sync is already running" }`

Requires `GARMIN_PERSONAL_API_KEY`; without it the import throws and the run is recorded as
failed.

---

## `GET /api/overview`

Everything the Overview screen needs, in one request.

```json
{
  "today":  { "local_date": "2026-10-22", "fitness": 73.33, "fatigue": 30.16, "form": 39.93, "...": "..." },
  "weeks":  [ { "week": "2026-17", "week_start": "2026-04-23", "rides": 3, "hours": 6.42, "km": 128.4, "elevation_m": 1820, "load_points": 412 } ],
  "recent": [ { "activity_id": 123, "activity_name": "Sofia Road Cycling", "...": "..." } ]
}
```

- `today` — the newest `daily_load` row, or `null` if nothing is imported.
- `weeks` — weekly rollups over the last 182 days, oldest first.
- `recent` — the ten newest rides.

---

## `GET /api/load`

The daily load series.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `from` | `1970-01-01` | Inclusive start date. |
| `to` | `2999-12-31` | Inclusive end date. |

```json
{
  "rows": [
    {
      "local_date": "2026-10-21",
      "load_points": 0, "ride_count": 1,
      "fitness": 75.12, "fatigue": 35.19, "form": 35.9,
      "is_warmup": 0, "unmeasured_rides": 1, "is_estimated": 1
    }
  ],
  "formula": "EWMA of Garmin activity training load; 42d fitness, 7d fatigue"
}
```

**Every calendar day has a row**, including rest days, which carry `load_points: 0` rather
than being absent. The three flags are what the dashboard draws:

| Flag | Meaning |
| --- | --- |
| `is_warmup` | Within the first 42 days of the history, where the curve has not settled. |
| `unmeasured_rides` | Rides **on this day** whose load the model cannot trust. |
| `is_estimated` | Some day within the preceding 42 days had an unmeasured ride, so this day's fitness is built on an incomplete window. |

---

## `GET /api/form`

Where today's form sits in the rider's own history. Everything here is read from
`daily_load`; nothing new is stored.

```json
{
  "position": {
    "date": "2026-10-22",
    "form": 39.93, "fitness": 73.33,
    "percentile": 99, "rank": 5, "measuredDays": 1430,
    "band": "freshest", "streak": 13,
    "change":     { "days": 28, "form": 42.55, "fitness": -20.99 },
    "lastInBand": "2026-10-04",
    "confidence": { "estimated": 53, "days": 90 }
  },
  "windows": { "change": 28, "confidence": 90 }
}
```

`position` is `null` while the whole history is still inside its 42-day warm-up.

| Field | Meaning |
| --- | --- |
| `percentile` | Share of measured days with a lower form. **Floored**, so a day with four days above it reports 99 rather than rounding to 100 and claiming to have beaten every day on record. |
| `rank` | 1 is the freshest day ever recorded. |
| `measuredDays` | Days behind the ranking. Warm-up days are not among them. |
| `band` | Which fifth of this rider's own form distribution today falls in: `buried`, `tired`, `typical`, `fresh`, `freshest`. Derived from the distribution, never from an absolute number. |
| `streak` | Consecutive days ending today on the same side of zero, today included. A form of exactly zero counts as the positive side. |
| `change` | Form **and** fitness over the same trailing window, with the span actually available — a young history reports what it measured rather than assuming 28 days. |
| `lastInBand` | The last day before the current run that was also in this band, or `null`. The current run is skipped, or the answer would always be yesterday. |
| `confidence` | How many of the last 90 days carry `is_estimated`. |

**Why `change` carries fitness.** Form rises when fitness falls exactly as it rises when
fatigue does. A +40 reached by tapering and a +40 reached by not riding for a fortnight are
the same number and opposite situations, and only the fitness line over the same window
tells them apart. The two are returned together so a caller cannot read one without the
other.

**Why the band and not a threshold.** The generic cycling figures — above +15 fresh, below
−10 tired — are somebody else's. Against this history −10 is an ordinary Tuesday: a quarter
of all measured days sit below it. The bands are fifths of the rider's own distribution, so
they mean something for this rider and nothing for anyone else.

---

## `GET /api/weeks`

Weekly rollups over an arbitrary range. Same `from` / `to` as `/api/load`.

```json
{ "rows": [ { "week": "2026-29", "week_start": "2026-07-20", "rides": 5, "hours": 25.1, "km": 486.2, "elevation_m": 7420, "load_points": 1384 } ] }
```

`week` is SQLite's `%Y-%W`. `week_start` is the first day in the range that fell in that week,
so the first and last weeks of a range may be partial.

---

## `GET /api/zones`

Seconds in each heart-rate zone over a span, with the span of equal length before it.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `from` | `1970-01-01` | Inclusive start date. |
| `to` | today | Inclusive end date. |

```json
{
  "period":   { "from": "2026-07-24", "to": "2026-10-22",
                "seconds": [64800, 132120, 131760, 52560, 14400], "zoneSeconds": 395640,
                "rides": 46, "ridesTotal": 50, "coverage": 0.91 },
  "previous": { "from": "2026-04-24", "to": "2026-07-23", "...": "..." }
}
```

| Field | Meaning |
| --- | --- |
| `seconds` | Five buckets, in seconds, summed over the rides that carried **all five**. |
| `rides` / `ridesTotal` | Rides that carried zones, and rides in the span. |
| `coverage` | `zoneSeconds` over the duration of **the rides that carried zones** — about 0.9 recently and 0.8 across the whole history, because paused and strapless time falls into no bucket. `null` when nothing carried them. |

A ride with a partial set of buckets is dropped rather than having its gaps read as zero, for
the same reason the load model flags a strapless ride instead of averaging it in.

`previous` exists so the two can be compared, but **only the shares are comparable** — zone
coverage differs between spans, so the absolute seconds behind them are not the same quantity.
The dashboard says so under the table.

---

## `GET /api/activities`

The paged ride list.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 50 | Capped at 200. |
| `offset` | 0 | |
| `type` | — | Exact `activity_type` match, e.g. `mountain_biking`. |
| `search` | — | Substring of the ride name **or** the location name. |
| `from`, `to` | — | Inclusive `local_date` bounds. |

```json
{ "total": 423, "limit": 50, "offset": 0, "rows": [ { "activity_id": 123, "...": "..." } ] }
```

`total` is the count **after** filtering. Rows are newest first and carry the full measured
set: distances, three durations, elevation, the power fields, training load, training effect,
heart rate, cadence and location.

---

## `GET /api/activities/:id`

One ride, with everything attached to it.

```json
{
  "activity":   { "activity_id": 123, "...": "every column" },
  "powerCurve": [ { "duration_s": 300, "watts": 288.4 } ],
  "fit":        { "status": "parsed", "record_count": 7412, "sample_rate_s": 1, "...": "..." }
}
```

`404 { "error": "Not found" }` if the id is unknown. `powerCurve` is empty and `fit` is `null`
for a ride with no power meter or one whose file has not been downloaded.

---

## `GET /api/power-curve`

The best power ever held at each duration, with the ride that set it.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `since` | — | Only consider rides on or after this `local_date`. |
| `to` | — | Only consider rides on or before this `local_date`. |

```json
{ "rows": [ { "duration_s": 300, "watts": 344.1, "activity_id": 123, "local_date": "2026-05-02" } ] }
```

One row per duration, ascending. Durations with no data are absent rather than zero.

Both bounds together are what make a season comparable with the one before it: the Trends
screen asks for this year, then for last year stopped on today's day of the year. A peak
held over ten months against one held over twelve is not a comparison.

---

## `GET /api/performance`

Everything the Performance screen shows: efficiency on road rides, critical power beside
Garmin's FTP, and ramp rate placed against the rider's own weeks. No parameters. Computed on
each request; nothing is stored. The maths is in [`performance.md`](performance.md).

```json
{
  "efficiency": {
    "months": [ { "month": "2026-09", "median": 1.29, "rides": 13 } ],
    "thisMonth": { "month": "2026-10", "median": 1.301, "rides": 3 },
    "recent": 1.286, "before": 1.194, "change": 0.076,
    "recentSpan": ["2026-07", "2026-09"], "beforeSpan": ["2026-04", "2026-06"],
    "rides": 84
  },
  "criticalPower": {
    "months": [ { "month": "2026-10", "cp": 228.1, "wPrimeJ": 21474, "rides": 34, "garminFtp": 237 } ],
    "window": {
      "from": "2026-07-28", "to": "2026-10-25",
      "bests": [ { "durationS": 1200, "watts": 245.1, "date": "2026-09-15" } ]
    }
  },
  "ramp": {
    "date": "2026-10-22", "perWeek": -6.93, "percentile": 5, "percentAbove": 94,
    "band": "lowest", "lastInBand": "2026-10-02", "estimated": true
  },
  "heldBack": 0,
  "formula": { "efficiency": "…", "criticalPower": "…", "ramp": "…" }
}
```

- `efficiency.months` holds complete months only, from the first qualifying ride, with empty
  months present. `median` is `null` for a month with fewer than 3 rides. The month in
  progress is `thisMonth`, never part of `months`.
- `recent`, `before` and `change` are `null` unless both three-month spans hold at least 5
  rides. `change` is a fraction: 0.076 is +7.6%.
- `criticalPower.months` runs from the first month with a parsed power curve to the month in
  progress, whose window ends today. `cp` and `wPrimeJ` are `null` when the window holds fewer
  than three of the four durations, or the fit gives no positive W′. `garminFtp` is the FTP in
  force on the window's last day, or `null` before the first.
- `window.bests` holds at most four rows, one per duration in seconds (120, 300, 600, 1200).
  A duration with no effort in the window is absent rather than zero.
- `ramp` is `null` until the history is longer than the warm-up plus a week. `date` is the
  latest day the load model holds, which is the last sync.
- Rides held back by the Garmin cross-check are excluded from every figure and counted in
  `heldBack`.

---

## `GET /api/seasons`

Each calendar year, counted only as far into it as today is.

```json
{ "rows": [ { "year": 2026, "rides": 147, "hours": 406.8, "km": 8054, "elevation_m": 105716, "load_points": 23442 } ] }
```

Newest year first. The cutoff is today's month and day, so a season in progress is held
against the same span of the ones before it rather than against their full twelve months.
The first year of the history is short for the same honest reason: it begins on the day
the account does.

---

## `GET /api/ftp`

The dated steps in Garmin's own threshold estimate.

```json
{ "steps": [ { "from": "2025-11-15", "watts": 189 }, { "from": "2026-01-25", "watts": 200 } ] }
```

Every powered ride carries the FTP in effect on its date, so no history table is needed:
this reduces those rides to the days the figure changed. `from` is the first ride that
carried the new value, which is the day it is known to have been in effect, not
necessarily the day Garmin decided it. The estimate falls as well as rises — it drifts
down when no hard effort is recorded — so a step down is not necessarily lost fitness.

---

## `GET /api/types`

Ride types with their counts and data quality. Drives the Activities filter and the Trends
share tables.

```json
{
  "rows": [
    { "activity_type": "mountain_biking", "n": 245, "powered": 0,  "no_load": 0,  "no_strap": 6 },
    { "activity_type": "road_biking",     "n": 112, "powered": 90, "no_load": 0,  "no_strap": 5 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `n` | Rides of this type. |
| `powered` | Rides with an average power reading. |
| `no_load` | Rides Garmin gave no training load at all. |
| `no_strap` | Rides with a load but no heart-rate reading, so the load is far too low. |

`no_load` and `no_strap` are disjoint, so `no_load + no_strap` is the number of rides of that
type the model cannot trust.

---

## Errors

A failed query propagates as a 500 with Hono's default body. There is no structured error
envelope: this is a single-user local server, and the dashboard shows the status text inside
the block that failed rather than as a page-level banner.
