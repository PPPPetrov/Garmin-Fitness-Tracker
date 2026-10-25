# Performance screen — design

Date: 25 October 2026
Status: agreed in conversation, awaiting review of this document
Branch: `claude/performance-screen`

## Why

The app answers "am I fitter?" with the load model, but fitness there is the 42-day average
of Garmin training load: it measures how much work has piled up, not what the body can do
with it. A month of hard riding raises it whether or not the rider got any stronger.

This screen adds the other half: three figures that move when the rider gets stronger or more
efficient, and do not move just because there was more riding.

It is the first of three projects agreed on 25 October 2026, after looking at what
intervals.icu, TrainingPeaks, Strava and VeloViewer offer:

1. **Performance** (this document): efficiency, critical power, ramp rate.
2. **Planning ahead**: form projected forward to a chosen date. Next.
3. **Motivation**: records and yearly bests, Eddington number, year in review, goals.

Each gets its own spec and plan. Heatmaps and explorer tiles were considered and set aside:
they need GPS tracks for every ride, which means downloading a FIT file for all 423.

Unchanged from [`plan.md`](../../plan.md): local only, no wellness data, nothing that tells
the rider what to ride, Garmin's estimates kept visually distinct from ours, missing data
shown as missing.

## What the data allows, measured 25 October 2026

These measurements shaped every rule below.

- **Power and heart rate together sit in two separate periods**: 34 indoor rides in 2022–23
  and 85 road rides from October 2025. Heart rate behaves differently indoors, so the two
  cannot share one efficiency trend. Efficiency covers road rides only, which in practice
  means the last twelve months.
- **The road rides are not steady.** Half of them have a variability index (normalized ÷
  average power) above 1.26, which is the Sofia terrain. The textbook rule of steady rides
  only (variability index ≤ 1.1, at least 40 minutes) leaves about 20 rides. The agreed choice
  is to use every road ride and accept a noisier monthly figure.
- **Critical power fitted from the stored curves tracks Garmin's FTP**: 228 W against
  Garmin's 237 W today, rising from 174 W in January 2026 to 234 W in August. There are no
  powered rides from 2024 to September 2025, so the series has a gap there.
- **Ramp rate has 1,423 measured days** to be placed against.

## The calculations

New file `src/calc/performance.ts`. Each calculation is a pure function over plain rows,
tested on its own, with a thin wrapper that reads the database, following
`formPosition` / `currentFormPosition` in `form.ts`. Nothing is stored and the schema does
not change: at this volume the endpoint computes in milliseconds.

### Efficiency

**Qualifying ride:** `activity_type = 'road_biking'`, `normalized_power` and `avg_hr` both
present, `moving_duration_s ≥ 1800`. That is 84 of 85 rides today. Indoor and virtual rides
are excluded. Strapless rides drop out on their own, because their `avg_hr` is null.

**Value per ride:** `normalized_power / avg_hr`, in watts per beat.

**Monthly series:** one entry per calendar month from the first qualifying ride's month to
the last complete month. `median` is the median of that month's rides, or null when the month
has fewer than 3. The month in progress is not in the series. Its own median and ride count
are reported separately as `thisMonth`.

**Headline:** the median of all qualifying rides in the last three complete months, against
the median of the three months before. Today that is July–September against April–June.
Each side needs at least 5 rides, otherwise both values and the change are null.
`change = recent / before − 1`.

### Critical power

**Inputs:** best mean power at 120, 300, 600 and 1200 s, from rides whose `fit_file.status`
is `parsed`. A ride the power check has sent back to `pending` is excluded, the same rule the
power records already follow.

**Window:** for each month, the 90 days ending on the month's last day. For the month in
progress, the window ends today (`today()` from `load.ts`). The best at each duration is the
highest across all rides in the window.

**Fit:** the two-parameter model `work = CP × t + W′`, where work = watts × t, fitted by
ordinary least squares over the durations present. At least 3 of the 4 durations must be
present. If the result has `CP ≤ 0` or `W′ ≤ 0`, the month is null rather than a value.

**Per month:** `cp` (W), `wPrimeJ` (J), `rides` (distinct rides in the window), and
`garminFtp`: the `ftp_at_ride` of the latest ride on or before the window's end, or null.
The series runs from the first month with a powered ride to the month in progress. A month
whose window holds too little is null, so the 2024–25 gap shows as a break in the line.

**Current window:** the bests behind the latest month, each with the date of the ride that
set it (`{ durationS, watts, date }[]`), plus the window's start and end. This is what the
"What these rest on" card reads.

### Ramp rate

**Value:** `fitness(d) − fitness(d − 7)` from `daily_load`, in load points per week. A day is
measured only when neither `d` nor `d − 7` is in the warm-up.

**Today:** the latest measured day the model holds.

**Placement:** against every measured day, using the same arithmetic as `formPosition`:
- `percentile`: the share of days with a lower ramp, floored.
- The fifth it falls in.
- `lastInBand`: the last day before the current run that was in the same fifth. Without
  skipping the current run, the answer would always be yesterday.
- `estimated`: copied from that day's `is_estimated`.

The shared helpers (`countBelow`, the fifths, the run-skipping search) move out of `form.ts`
into a small shared module rather than being copied.

## API

`GET /api/performance`, no parameters:

```ts
{
  efficiency: {
    months: { month: string; median: number | null; rides: number }[];
    thisMonth: { month: string; median: number | null; rides: number };
    recent: number | null; before: number | null; change: number | null;
    recentSpan: [string, string]; beforeSpan: [string, string];   // 'YYYY-MM'
    rides: number;                                                 // all qualifying
  };
  criticalPower: {
    months: { month: string; cp: number | null; wPrimeJ: number | null;
              rides: number; garminFtp: number | null }[];
    window: { from: string; to: string;
              bests: { durationS: number; watts: number; date: string }[] };
  };
  ramp: { date: string; perWeek: number; percentile: number;
          band: 'lowest' | 'low' | 'middle' | 'high' | 'highest';
          lastInBand: string | null; estimated: boolean } | null;
  heldBack: number;                       // powerCurveHeldBack(), all time
  formula: { efficiency: string; criticalPower: string; ramp: string };
}
```

The new endpoint is documented in `docs/api.md`, with a typed fetch added to `web/src/api.ts`
through the existing `useApi`.

## The screen

`web/src/views/Performance.tsx`. A fourth menu item, **Performance**, between Trends and
Activities, reached at `#performance`. It has no range control.

**Question:** Is my body getting stronger, not just busier?

**Finding under the title.** The first rule that applies:
1. Ramp rate at or above the 90th percentile: "Fitness is building faster than on 9 in 10
   of your weeks: +X a week."
2. Efficiency `change` of at least 3% either way: "Efficiency is up 8% on the three months
   before: 1.29 watts per beat against 1.19."
3. Critical power and Garmin's FTP both present: "Critical power is 228 W, 9 W under
   Garmin's estimate."
4. Otherwise: "No powered rides yet, so there is nothing to measure here."

**Layout**, from the existing grid classes:

| Row | Grid | Cards |
| --- | --- | --- |
| 1 | `grid-1-1-1` | Critical power · Efficiency · Ramp rate |
| 2 | `grid-2-1` | Critical power and Garmin's FTP · Best power by season |
| 3 | `grid-2-1` | Efficiency by month · What these rest on |

**Row 1, KPI cards:**
- **Critical power:** the latest `cp` in W. Caption: "W′ 21.5 kJ · 9 W under Garmin's FTP".
  The difference is good-toned when above Garmin's figure and grey when below. Ours falling
  short of Garmin's is not bad training.
- **Efficiency:** `recent` to two decimals, "W per beat". Caption: the change on `beforeSpan`
  ("+8% on Apr–Jun"), good or bad toned.
- **Ramp rate:** signed `perWeek` to one decimal, "a week". Caption: "Faster than {p}% of
  your weeks" when the ramp is zero or more. When it is negative: "Steeper fall than {q}% of
  your weeks", where q is the floored share of days with a higher ramp. When `estimated` is
  true, the caption ends with "· less sure".

**Row 2:**
- **Critical power and Garmin's FTP:** a `LineChart`, 300 px tall, one point per month.
  Critical power in `--chart-1`, Garmin's FTP in `--chart-2`, broken where either is null.
  The tooltip names the month. The month in progress is labelled "to 25 Oct". Note under
  the chart: "From {rides} rides in the 90 days to {to}."
- **Best power by season:** moved from Trends without changes, including its held-back note.

**Row 3:**
- **Efficiency by month:** a `LineChart` of the monthly medians, broken at null months. Note:
  "{rides} road rides since {first month}. Months with fewer than 3 are left out.
  {This month} so far: {median} from {n} rides."
- **What these rest on:** a `.rows` list.
  - Each of the four critical-power bests, with its watts and date.
  - Efficiency rides this month and in total.
  - Rides held back by the power check.
- **Height check:** the two cards in this row must end level at 1440 px. If they do not, the
  chart height is the variable to adjust.

**ⓘ text, behind the info marks, not on the card:**
- Critical power: the model, the 90-day window, and that it only knows the efforts actually
  ridden. Without a hard 5- and 20-minute effort in the window it reads low, which is why
  November 2023 shows 110 W.
- Efficiency: normalized power per heartbeat. Road rides only, because indoor heart rate runs
  differently. Heat raises heart rate, so a hot month reads lower.
- Ramp rate: the weekly change in fitness, placed against the rider's own weeks rather than
  generic TSS rules, which belong to a different scale.

**States**, following `docs/interface.md`:
- Loading: skeletons at final size.
- Error: inside the failing card, as one sentence plus what to do.
- Empty: the frame plus one sentence, e.g. "No powered ride in the last 90 days, so there is
  no estimate." for the critical power card.
- Missing values: the grey `DASH`.
- On a phone the rows stack as on the other screens.

## Changes elsewhere

- **Trends:**
  - Remove Best power by season (moved) and Threshold power (now the grey line on
    Performance).
  - The Form row becomes `grid-2-1`, with Form beside a `column` holding Rides by type and
    Rides the model cannot trust.
  - The `grid-1-1-1` row goes.
  - The subtitle becomes "Training load over {range}."
  - Code used only by the removed cards moves to Performance or is deleted.
- **Overview:** the Best power held card's footer link points to `#performance`.
- **App:** a new `VIEWS` entry and route.
- **`/api/ftp`:** deleted, along with its section in `docs/api.md`. Trends' Threshold power
  card is its only caller today, and Performance gets Garmin's FTP inside
  `/api/performance`.

## Tests

`src/calc/performance.test.ts`, node:test, alongside the existing 49.

**Efficiency:**
- Indoor rides, rides without heart rate, and rides under 30 minutes are excluded.
- The median is correct for odd and even counts.
- A month with 3 rides has a median; a month with 2 is null.
- The month in progress is not in `months` but appears in `thisMonth`.
- The headline uses complete months only, and is null when either side has fewer than 5
  rides.

**Critical power:**
- Bests generated from a known CP and W′ (`watts = CP + W′ / t`) return both within
  rounding.
- Two durations give null. A fit with W′ ≤ 0 gives null.
- A ride 90 days before the window's end is outside the window, and one 89 days before is
  inside.
- Held-back rides are excluded, tested on the wrapper's query.
- Garmin's FTP is taken on or before the window's end.

**Ramp rate:**
- The 7-day difference is correct.
- A day whose `d − 7` is in the warm-up is skipped.
- The percentile is floored.
- `lastInBand` skips the current run.
- `estimated` is carried through.

**Also:**
- `npm test` and `npm run typecheck` pass.
- The screen is checked in the browser at 1440, 900 and 375 px, with rows ending level.
- Trends and Overview are checked again after the move.

## Docs

- New `docs/performance.md`: the three calculations in the style of `load-model.md`, with
  what the tests pin down.
- `docs/api.md`: the endpoint.
- `docs/interface.md`: the screens table, the Performance shape, and the new Trends shape.
- `README.md`: the screens table, and a "Measures performance" paragraph in What it does.
- `docs/plan.md`: the three-project roadmap, with this one marked built when it lands.

## Not in this project

- Steady-ride efficiency, aerobic decoupling, and heart rate at a fixed power. These need
  per-second streams.
- Power per kilogram. It needs the weight endpoint, which has not been probed.
- A three-parameter critical power model, or estimated FTP from single efforts.
- Any range control on Performance.
- Form projection and the motivation features, which are projects 2 and 3.

## Expected values on 25 October 2026

A sanity check for the finished screen against today's database. It is not a test fixture.

| Figure | Expected |
| --- | --- |
| Efficiency rides | 84 |
| Efficiency Jul–Sep against Apr–Jun | 1.29 (40 rides) against 1.19 (21 rides), +8% |
| Critical power, window to 25 Oct | 228 W, W′ 21.5 kJ, 34 rides |
| Bests in that window | 2 min 371 W (27 Aug) · 5 min 315 W (20 Aug) · 10 min 265 W (13 Aug) · 20 min 245 W (15 Sep) |
| Garmin's FTP | 237 W, as of 19 Oct |
| Ramp rate, latest day (22 Oct) | −6.9 a week, 6th percentile, flagged less sure |
| Held back | 0 |
| Finding | Rule 2: efficiency up 8% |
