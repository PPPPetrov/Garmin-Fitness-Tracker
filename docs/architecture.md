# Architecture

One Node process talks to Garmin and writes a SQLite file; a second serves that file as JSON;
a React app reads the JSON. Nothing else is involved.

```
Garmin Personal API
        │  HTTPS, ApiKey → bearer token
        ▼
   src/garmin/      client: token exchange, rate-limit backoff, endpoints
        │
        ▼
   src/sync/        import: list → detail → normalise → upsert
                    fit:    download .fit → unzip → parse → power curve
        │
        ▼
   data/garmin.db   SQLite (WAL). The only durable state.
        │
        ├──────────► src/calc/      the load model, recomputed wholesale
        │
        ▼
   src/server.ts    Hono, JSON over HTTP on localhost
        │
        ▼
   web/src/         React + Vite, no state library, no data library
```

## Source layout

```
src/
  config.ts     every setting, read from the environment once
  garmin/
    auth.ts     Personal API key → 24-hour bearer token, cached on disk
    client.ts   request plumbing: rate limits, retries, the endpoints used
  db/
    schema.sql  the whole schema, idempotent
    index.ts    connection, schema application, column migrations
  sync/
    import.ts   activity import
    fit.ts      FIT download, ZIP extraction, power-curve computation
  calc/
    load.ts     the fitness/fatigue model and the power-curve queries
  server.ts     the JSON API
  cli.ts        sync, stats, recompute
web/src/
  api.ts        fetch helpers and every response type
  format.ts     every number, date and name that reaches the screen
  charts/       Line, Bars, LoadCalendar, Gauge, Ring, DayBars — hand-drawn SVG, no chart library
  views/        Overview, Trends, Activities
  ui.tsx        Card, Info, More, Delta and the shared icons
  app.css       the design system; see interface.md
data/           SQLite database, token cache, FIT scratch (git-ignored)
```

## The Garmin client

`src/garmin/client.ts` is the only code that makes network calls.

**Authentication.** The Personal API key is not a bearer token. It is exchanged at
`/personalapitoken-service/personal-api/personal-api-key/token` for a JWT that lives exactly
24 hours. The endpoint returns the raw JWT as `text/plain`, not JSON, and there is no refresh
token: renewing means exchanging the key again. `auth.ts` caches the token in memory and in
`data/token.json` (mode `0600`) and re-exchanges it an hour before it expires, or immediately
if a request comes back 401.

**Rate limiting.** Undocumented, and observed: 100 requests per rolling window, then HTTP 429
with a body of `{"count":101,"limit":100,"retryInSeconds":33}`. The server states how long to
wait, so the client honours that number rather than guessing a backoff, and retries up to five
times. `setThrottleListener` lets the CLI print each pause.

**Endpoints used.**

| Endpoint | Used for |
| --- | --- |
| `GET /activitylist-service/activities/search/activities` | paging the activity list |
| `GET /activity-service/activity/{id}` | the detail record for one ride |
| `GET /download-service/files/activity/{id}` | the original `.fit`, inside a ZIP |
| `GET /userprofile-service/...` | profile settings and heart-rate zones |

Two traps are handled in the client itself. The search endpoint answers HTTP **500**, not 400,
for `limit >= 64`, so the page size is pinned at 50. The download endpoint answers HTTP **406**
unless `Accept` includes `application/x-zip-compressed`. Both are recorded with the responses
that showed them in [`data-inventory.md`](data-inventory.md).

## The import pipeline

`syncActivities()` in `src/sync/import.ts`:

1. **Page the list.** 50 activities at a time, newest first, until a page comes back short.
   In incremental mode it stops once it reaches rides already stored, then re-checks the last
   30 days anyway so edits made in Garmin Connect are picked up.
2. **Fetch the detail** for any ride whose `detail_fetched` flag is 0. The list record and the
   detail record disagree about several fields; the detail wins.
3. **Normalise.** Garmin reports three durations that disagree with each other, so all three
   are stored. Power fields are `NULL` on rides with no power meter — never zero.
4. **Upsert** keyed on `activity_id`, and keep the raw JSON of both responses in
   `activity_raw`, so reprocessing never needs another round trip.
5. **Record the run** in `sync_run`: what was seen, added, updated, and whether it finished.

The load model is then recomputed wholesale. At this data volume — a few thousand days — that
is cheaper and far easier to reason about than an incremental update, and it means a change to
the formula only needs `npx tsx src/cli.ts recompute`.

## FIT files

`npm run sync:fit` is a separate pass because it is slow and only useful for rides with a
power meter.

For each powered ride: download, unwrap the ZIP, parse the FIT with `@garmin/fitsdk`, compute
the peak mean power at each of thirteen durations (1, 5, 10, 15, 30, 60, 120, 300, 600, 1200,
1800, 3600 and 5400 seconds), store the curve and keep the file in `data/fit-cache`. A ride
whose file is already there is parsed from disk, so a parser change costs no requests.
Progress is tracked per ride in `fit_file`, so an interrupted backfill resumes.

Every curve is then checked against Garmin's own `maxAvgPower_*` figures from the stored list
response (`src/sync/powerCheck.ts`). A ride that disagrees by more than 1 % or 2 W at any
shared duration goes back to `pending`, and `bestPowerCurve` reads only `parsed` rides, so a
parser fault cannot hold a record.

Three things the tests pin down, each of which was wrong at some point:

- **Gaps count as zero watts.** A dropout is not a shorter ride; averaging over the samples
  present would invent a higher peak than was ridden.
- **Windows are seconds, not records.** Readings are laid on a one-second grid by
  timestamp, each standing for one interval of the file's recording rate. A pause is time at
  zero watts; counting records instead once let a 26-second pause make a one-minute window
  two records wide.
- **Durations longer than the ride are left out**, not reported as zero.

The ZIP tests build archives by hand, including the streamed variant whose local header
reports a compressed size of zero. That is a regression test: the real thing failed all 135
downloads.

## The JSON API

`src/server.ts` is a Hono app with no authentication, intended for `localhost` only. Every
endpoint is a direct SQL query; there is no ORM and no caching layer. See
[`api.md`](api.md) for the full reference.

A sync triggered from the dashboard runs in-process and is guarded by a single promise, so a
second request returns HTTP 409 rather than starting a parallel import.

## The web app

React 18 with Vite, and deliberately little else:

- **No state library.** `useApi` is twelve lines: a `fetch` in an effect with a
  `{ loading | error | ready }` union. Every screen handles all three states.
- **No chart library.** The three charts are hand-drawn SVG in `web/src/charts/`, measured in
  real pixels with a `ResizeObserver` so axis labels stay at a readable size instead of being
  scaled with a fixed `viewBox`.
- **No router.** Three screens behind `location.hash`.
- **One formatting module.** Everything that reaches the screen goes through
  `web/src/format.ts`, which is why a missing value is always a grey dash and never a zero.

Vite proxies `/api` to the API port, so the browser only ever talks to one origin.

## Configuration

Every setting is read once, in `src/config.ts`, from the environment via `dotenv`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GARMIN_PERSONAL_API_KEY` | — | Required for anything that calls Garmin. Read lazily, so the server and the read-only CLI commands start without it. |
| `GARMIN_PERSONAL_API_BASE_URL` | `https://personal.connectapi.garmin.com` | API host. |
| `DATABASE_PATH` | `./data/garmin.db` | SQLite file. |
| `FIT_CACHE_PATH` | `./data/fit-cache` | Downloaded FIT files, kept so a re-parse needs no network. `--discard-files` skips keeping them. |
| `TOKEN_CACHE_PATH` | `./data/token.json` | Cached bearer token, written `0600`. |
| `DISPLAY_TIMEZONE` | `Europe/Athens` | Reported by `/api/status`. Day grouping uses Garmin's own `local_date`, not this. |
| `API_PORT` | `8787` | Where `src/server.ts` listens. |
| `WEB_PORT` | `5273` | Where Vite serves, and what its `/api` proxy points at. |

## Things worth knowing before changing anything

- **`local_date` is Garmin's local calendar day, not a UTC date.** Every daily rollup groups
  by it. Do not recompute it from a UTC timestamp.
- **`NULL` means the sensor was absent.** Coalescing a power field to zero silently turns a
  mountain-bike ride into a very easy road ride.
- **The load series keeps full precision between days and rounds only what it stores.**
  Rounding each day before feeding the next changes a form of −35.71 into −35.72, and one test
  exists purely to pin that.
- **`CREATE TABLE IF NOT EXISTS` never adds a column.** New columns go in the `migrate()` map
  in `src/db/index.ts` as well as in `schema.sql`.
