# Garmin Fitness Tracker

A private cycling tracker built on the Garmin Connect Personal API. It imports the whole ride
history into a local SQLite file and shows how training load, fitness and power records have
moved over time.

Nothing leaves the machine. There is no account, no hosting and no telemetry.

- [`PLAN.md`](PLAN.md) — what is being built and why
- [`DATA-INVENTORY.md`](DATA-INVENTORY.md) — what the API actually returns for this account,
  measured rather than assumed, including four undocumented traps

## Setup

Node 22 or newer.

```bash
npm install
```

Create a Personal API key at <https://connect.garmin.com/app/settings/personalApiToken>. It is
shown once, so treat it like a password. Then:

```bash
cp .env.example .env
```

and put the key in `GARMIN_PERSONAL_API_KEY`. `.env` is git-ignored; never commit it.

## Importing

```bash
npm run sync
```

Pulls every activity and its detail. The first run fetches the full history — 423 rides back to
October 2022 at the time of writing — and pauses when the API rate-limits it, which it will
roughly five times. Re-running is safe: rides are keyed by their Garmin id, so an interrupted
import resumes rather than duplicating.

```bash
npm run sync:fit
```

Also downloads the original `.fit` files for rides that have a power meter and extracts the peak
power at each duration from 1 second to 90 minutes. Only the derived curve is stored; the files
are discarded. Rides with no power meter are skipped, because there is nothing in them to extract.

```bash
npm run stats                 # coverage and the current numbers, in the terminal
npx tsx src/cli.ts recompute  # rebuild the load model without touching the network
```

## Running the app

```bash
npm run dev
```

The API starts on <http://localhost:8787> and the interface on <http://localhost:5273>.

## Tests

```bash
npm test          # node:test via tsx
npm run typecheck
```

29 tests over the two parts that are easy to get quietly wrong.

**The load model** ([`src/calc/load.test.ts`](src/calc/load.test.ts)) — that every calendar day
gets a row so a rest day is a zero rather than a gap; that fitness and fatigue move by
`load/42` and `load/7`; that form lags a day; that both decay towards zero through a rest and
converge on a steady load with fatigue arriving first; that the warm-up and estimated flags
cover exactly 42 days and that overlapping unmeasured rides leave no clear day between them.
One test pins the rounding: the series keeps full precision between days and rounds only what
it stores, which is the difference between a form of −35.71 and −35.72.

A database test covers the classification itself — a ride with no load, a ride with a load but
no heart-rate strap, and a short strapless ride that should not be flagged.

**FIT handling** ([`src/sync/fit.test.ts`](src/sync/fit.test.ts)) — the power curve against
hand-computed peaks, gaps counted as zero watts, windows scaled by the sample rate, and
durations longer than the ride left out rather than reported as zero. The FIT tests build real
files with the SDK's `Encoder`, so `parseFit` is exercised end to end, including a ride with no
power meter.

The ZIP tests build archives by hand, including the streamed variant whose local header reports
a compressed size of zero. That is a regression test: the real thing failed all 135 downloads.

## How the numbers are built

Fitness and fatigue are exponentially weighted averages of Garmin's `activityTrainingLoad`, over
42 and 7 days. Form is fitness minus fatigue. The formula is in [`src/calc/load.ts`](src/calc/load.ts)
and stated on the page itself.

Training load is used rather than TSS because only a third of these rides have a power meter —
mountain biking, which is most of the riding, has none — so a TSS curve would read the biggest
days as rest.

Two things are shown as unreliable rather than quietly averaged in:

- a ride Garmin gave no training load;
- a ride recorded without a heart-rate strap, where Garmin returns a load about eight times too
  low instead of returning nothing.

Both are counted, and every day within 42 of one is marked, because those days feed the same
42-day window.

## Layout

```
src/
  garmin/     API client: key-to-token exchange, rate-limit backoff, endpoints
  db/         schema and connection
  sync/       activity import, FIT download and parsing
  calc/       the load model and power curve queries
  server.ts   JSON API
  cli.ts      sync, stats, recompute
web/src/      React interface
data/         SQLite database and token cache (git-ignored)
```
