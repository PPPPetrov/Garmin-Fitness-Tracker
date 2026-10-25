# Garmin Fitness Tracker

A private cycling tracker built on the Garmin Connect Personal API. It imports a whole ride
history into a local SQLite file and shows how training load, fitness and power records have
moved over time.

Nothing leaves the machine. There is no account, no hosting, no telemetry and no third-party
service: a Node process talks to Garmin, writes a file on disk, and serves a dashboard to
`localhost`.

It is built for one rider's data, but nothing in it is specific to that account — point it at
your own Personal API key and it will import your history instead.

## What it does

**Imports** every activity and its detail through Garmin's Personal API, handling the
rate limiter, the token exchange and four undocumented traps in the API (see
[`docs/data-inventory.md`](docs/data-inventory.md)). Re-running is safe: rides are keyed by
their Garmin id, so an interrupted import resumes rather than duplicating.

**Optionally downloads the original `.fit` files** for rides with a power meter and extracts
the peak mean power at thirteen durations from 1 second to 90 minutes. Only the derived curve
is kept; the files are discarded.

**Models training load** as two exponentially weighted averages of Garmin's
`activityTrainingLoad` — 42 days for fitness, 7 for fatigue, with form the difference. The
maths is in [`docs/load-model.md`](docs/load-model.md).

**Places today's form** against every day the model has measured, rather than against the
generic cycling thresholds, which belong to somebody else's history — against this one, −10 is
an ordinary Tuesday. It reports the rank, the fifth of your own distribution you are in, how
long you have been on this side of zero, and when you were last here. It reports the change in
fitness over the same four weeks beside the change in form, because form rises when fitness
falls exactly as it rises when fatigue does, and only the pair tells a taper from a fortnight
off. It does not tell you what to ride.

**Measures performance**, not just load. Fitness in the load model rises with any month of hard
riding, so a separate screen shows three figures that move only when the rider gets stronger:
efficiency (normalized power per heartbeat, on road rides), critical power fitted from the
90-day best efforts and drawn beside Garmin's own FTP, and the weekly ramp in fitness placed
against the rider's own weeks. The maths is in [`docs/performance.md`](docs/performance.md).

**Projects form forward.** Pick an event date and a share of your own usual load (rest, half,
the usual, more) and the Planning screen carries fitness, fatigue and form to that day with the
same arithmetic as the load model, drawn in a paler line so it is not mistaken for a
measurement. It says how long the projection stays less sure, given the unmeasured rides in the
last 42 days. It is not a forecast and no scenario is suggested. The maths is in
[`docs/planning.md`](docs/planning.md).

**Breaks the riding down by heart-rate zone**, which is the only intensity measure here that
reaches the mountain biking, where there is no power meter. Garmin reports five buckets per ride
in the activity list; they sit on 264 of 423 rides and on none before 2024. The figures are
shares of recorded time rather than of the ride, because paused and strapless time falls into no
bucket, and a ride carrying a partial set is dropped rather than having its gaps read as zero.

**Tells you where it cannot see.** Two kinds of ride carry a training load the model cannot
trust: one Garmin gave no load at all, and one recorded without a heart-rate strap, where
Garmin returns a figure about eight times too low instead of returning nothing. Both are
counted rather than quietly averaged in, every day within 42 days of one is marked, and the
dashboard draws those days as open columns rather than solid ones.

**Serves five screens** on `localhost`:

| Screen | The question it answers |
| --- | --- |
| Overview | Am I fitter than I was, and how much fatigue am I carrying into today? |
| Trends | How has the load moved over this period, and what are my best powers? |
| Performance | Is my body getting stronger, not just busier? |
| Planning | Where would my form be on the day, if I rode this much until then? |
| Activities | Find the ride I am thinking of. |

## Requirements

- Node 22 or newer
- A Garmin Connect account with cycling activities
- A Garmin Connect **Personal API key**

## Setup

```bash
npm install
```

Create a Personal API key at <https://connect.garmin.com/app/settings/personalApiToken>. It is
shown once, so treat it like a password. Then:

```bash
cp .env.example .env
```

and put the key in `GARMIN_PERSONAL_API_KEY`. `.env` is git-ignored; never commit it. Every
setting is listed in [`.env.example`](.env.example) and explained in
[`docs/architecture.md`](docs/architecture.md#configuration).

## Importing

```bash
npm run sync
```

Pulls every activity and its detail. The first run fetches the full history and pauses when the
API rate-limits it, which it will roughly once per hundred requests. For a four-year history of
about 400 rides, expect a few minutes and about five pauses.

```bash
npm run sync:fit
```

Also downloads the original `.fit` files for rides with a power meter and extracts the power
curve. Rides with no power meter are skipped, because there is nothing in them to extract. The
files are kept in `data/fit-cache` (about 335 MB for the full history) so a re-parse reads the
disk; pass `-- --discard-files` to skip that. Each curve is checked against Garmin's own peak
power figures, and a ride that disagrees is left out of the records until it parses cleanly.

```bash
npm run stats                 # coverage and the current numbers, in the terminal
npx tsx src/cli.ts recompute  # rebuild the load model without touching the network
npx tsx src/cli.ts backfill   # promote stored fields into columns, also offline
npx tsx src/cli.ts verify-power  # check stored power curves against Garmin's, offline
```

## Running the dashboard

```bash
npm run dev
```

The API starts on <http://localhost:8787> and the interface on <http://localhost:5273>. Both
ports are configurable — set `API_PORT` and `WEB_PORT` in `.env` to run a second checkout
alongside the first.

Reading an already-imported database needs no Garmin key: the key is only read when something
actually calls Garmin, so you can browse and develop against an existing `data/garmin.db`
without one.

## Tests

```bash
npm test          # node:test via tsx
npm run typecheck
```

49 tests over the four parts that are easy to get quietly wrong: the load model, where today's
form sits, the heart-rate zone totals, and FIT handling. What each one pins down is described in
[`docs/load-model.md`](docs/load-model.md#what-the-tests-pin-down),
[`docs/load-model.md`](docs/load-model.md#what-the-form-tests-pin-down) and
[`docs/architecture.md`](docs/architecture.md#fit-files).

## Documentation

| Document | What is in it |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | How the pieces fit: the import pipeline, the Garmin client, FIT handling, configuration, the layout of the source |
| [`docs/performance.md`](docs/performance.md) | Efficiency, critical power and ramp rate: the rules, the data limits, and what the tests pin down |
| [`docs/planning.md`](docs/planning.md) | The projection: the scenario, the even-spread assumption, where it is less sure, and what the tests pin down |
| [`docs/load-model.md`](docs/load-model.md) | The fitness and fatigue maths, the warm-up window, how unreliable rides are handled, and what the tests pin down |
| [`docs/data-model.md`](docs/data-model.md) | Every table and column, and why each one exists |
| [`docs/api.md`](docs/api.md) | The local HTTP API: every endpoint, its parameters and its response shape |
| [`docs/interface.md`](docs/interface.md) | The dashboard's design system: tokens, type, charts, states and the rules the screens follow |
| [`docs/data-inventory.md`](docs/data-inventory.md) | What Garmin's Personal API actually returns, measured rather than assumed, including four undocumented traps |
| [`docs/plan.md`](docs/plan.md) | What is being built and why, and what the data forced the design to change |

## What it deliberately does not do

- **No wellness data.** Sleep, HRV, Body Battery, stress, steps, resting heart rate and
  Training Readiness all come back empty for an account whose only device is a bike computer.
  They are out of scope rather than deferred.
- **No TSS-based curve.** Only about a third of these rides have a power meter — mountain
  biking, which is most of the riding, has none — so a TSS curve would read the biggest days
  as rest. Garmin's heart-rate-derived training load is used instead, because it is present on
  the whole history.
- **No recovery claim.** Fitness, fatigue and form are arithmetic over Garmin's load numbers.
  They describe what you have done, not how recovered you are.
- **No hosting.** There is no authentication, so do not expose the API port beyond
  `localhost`.

## Privacy

`data/` holds the SQLite database, the cached bearer token and any downloaded ride files. The
whole directory is git-ignored, along with `.env`, `*.key`, `*.fit` and `*.zip`. Nothing is
sent anywhere except to Garmin's own API, with your own key.

## Licence

MIT. See [`LICENSE`](LICENSE).
