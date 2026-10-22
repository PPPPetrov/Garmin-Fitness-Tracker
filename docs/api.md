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

## `GET /api/weeks`

Weekly rollups over an arbitrary range. Same `from` / `to` as `/api/load`.

```json
{ "rows": [ { "week": "2026-29", "week_start": "2026-07-20", "rides": 5, "hours": 25.1, "km": 486.2, "elevation_m": 7420, "load_points": 1384 } ] }
```

`week` is SQLite's `%Y-%W`. `week_start` is the first day in the range that fell in that week,
so the first and last weeks of a range may be partial.

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

```json
{ "rows": [ { "duration_s": 300, "watts": 344.1, "activity_id": 123, "local_date": "2026-05-02" } ] }
```

One row per duration, ascending. Durations with no data are absent rather than zero.

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
