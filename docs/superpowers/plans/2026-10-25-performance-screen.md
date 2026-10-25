# Performance Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Performance screen showing efficiency on road rides, critical power beside Garmin's FTP, and ramp rate against the rider's own weeks, and slim Trends down to load only.

**Architecture:** Pure calculations in a new `src/calc/performance.ts`, each tested with node:test, plus one wrapper that reads SQLite and feeds them. `GET /api/performance` returns the wrapper's report. A new React view renders it using the existing cards and `LineChart`. No schema change.

**Tech Stack:** TypeScript, Hono, better-sqlite3, node:test via tsx, Vite + React, hand-drawn SVG charts.

**Spec:** [`docs/superpowers/specs/2026-10-25-performance-screen-design.md`](../specs/2026-10-25-performance-screen-design.md). Read it before starting any task; this plan cites it rather than repeating it.

## Global Constraints

- Branch `claude/performance-screen`. Commit after every task. Never push.
- Commit messages follow the repo's style: an imperative sentence as the subject (e.g. "Fit critical power to the stored curves"), a short body saying why, and ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new dependencies. No schema change.
- Code, comments and docs are in English. Comment density and tone match `src/calc/form.ts`: a doc comment saying *why* on each exported function and on each non-obvious rule.
- UI follows `docs/interface.md`:
  - Missing values are `DASH` from `format.ts`, never 0.
  - `--chart-1` for our series, `--chart-2` for Garmin's.
  - Definitions go in `info`, never in the card body.
  - Loading uses a skeleton at final size; errors appear inside the failing card.
- Run `npm test` and `npm run typecheck` before every commit. Both must pass.

## Review Focus

1. **A fresh database, or one with no powered rides.** Every pure function returns empty arrays or nulls without throwing, the endpoint returns 200, and every card shows its empty sentence. Pinned in Tasks 2, 3, 4 ("empty input") and Task 6 (browser check with an empty DB).
2. **A year boundary in the efficiency headline.** In January, the last three complete months are Oct–Dec of the year before. Pinned in Task 2.
3. **No Garmin FTP on file before the first powered ride with one.** `garminFtp` is null, and the critical power caption drops the comparison instead of printing "NaN W under". Pinned in Task 3 and Task 6.
4. **A history shorter than the warm-up plus a week.** `rampPosition` returns null and the ramp card shows a dash. Pinned in Task 4.
5. **A stale sync.** The ramp figure belongs to the latest day `daily_load` holds (22 Oct today), not to today. The ramp card's `aside` shows that date. Pinned in Task 6.

---

### Task 1: Share the ranking helpers between form and ramp rate

**Files:**
- Create: `src/calc/rank.ts`, `src/calc/rank.test.ts`
- Modify: `src/calc/form.ts` (remove `countBelow`, `countAtOrBelow`, and the inline run-skipping loop; import from `rank.ts`)

**Interfaces:**
- Produces:
  - `countBelow(sorted: readonly number[], value: number): number` (moved unchanged)
  - `countAtOrBelow(sorted: readonly number[], value: number): number` (moved unchanged)
  - `flooredPercentile(sorted: readonly number[], value: number): number`: `Math.floor(100 * countBelow / n)`
  - `fifthOf(percentile: number): 0 | 1 | 2 | 3 | 4`, with edges at 20, 40, 60 and 80, where a percentile below the edge belongs to the lower fifth
  - `lastBeforeRun<T>(items: readonly T[], sameAsLast: (item: T) => boolean): number`: the index of the last item before the current trailing run for which `sameAsLast` is true, or −1

- [ ] **Step 1: Write the failing tests in `src/calc/rank.test.ts`**

```ts
it('floors the percentile so it never claims every day', () => {
  assert.equal(flooredPercentile([1, 2, 3], 3), 66);
});
it('puts a percentile on an edge into the upper fifth', () => {
  assert.equal(fifthOf(19), 0);
  assert.equal(fifthOf(20), 1);
  assert.equal(fifthOf(80), 4);
});
it('skips the current run when looking for the last match', () => {
  // classes: a a b b a a   -> current run is the last two 'a', previous 'a' is index 1
  const items = ['a', 'a', 'b', 'b', 'a', 'a'];
  assert.equal(lastBeforeRun(items, (x) => x === 'a'), 1);
  assert.equal(lastBeforeRun(['b', 'a'], (x) => x === 'a'), -1);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `rank.js` does not exist.
- [ ] **Step 3: Create `src/calc/rank.ts` with the five functions, and refactor `formPosition` to use them.** `BAND_EDGES` becomes a lookup from `fifthOf(...)` to `FormBand`. Behaviour must not change.
- [ ] **Step 4: Run `npm test`.** Expected: PASS, with every existing `form.test.ts` case unchanged.
- [ ] **Step 5: Commit**: "Share the ranking arithmetic form uses".

---

### Task 2: Efficiency by month

**Files:**
- Create: `src/calc/performance.ts`, `src/calc/performance.test.ts`, `docs/performance.md`

**Interfaces:**
- Produces, in `performance.ts`:
  - `export interface EfficiencyRide { date: string; type: string; normalizedPower: number | null; avgHr: number | null; movingS: number | null }`
  - `export interface EfficiencyMonth { month: string; median: number | null; rides: number }`
  - `export interface EfficiencyReading { months: EfficiencyMonth[]; thisMonth: EfficiencyMonth; recent: number | null; before: number | null; change: number | null; recentSpan: [string, string]; beforeSpan: [string, string]; rides: number }`
  - `export function efficiencyReading(rides: readonly EfficiencyRide[], today: string): EfficiencyReading`
  - Helpers, exported for Task 3: `monthOf(date: string): string` (`'YYYY-MM'`), `addMonths(month: string, n: number): string`, `median(values: readonly number[]): number | null`
- Constants, exported:
  - `EFFICIENCY_TYPE = 'road_biking'`
  - `EFFICIENCY_MIN_MOVING_S = 1800`
  - `EFFICIENCY_MIN_MONTH_RIDES = 3`
  - `EFFICIENCY_MIN_SPAN_RIDES = 5`
  - `EFFICIENCY_SPAN_MONTHS = 3`

**Rules:** the spec's "Efficiency" section, exactly.
- `months` runs from the first qualifying ride's month to the month before `monthOf(today)`, and includes empty months as `{ median: null, rides: 0 }`.
- `recentSpan = [addMonths(m, -3), addMonths(m, -1)]` and `beforeSpan = [addMonths(m, -6), addMonths(m, -4)]`, where `m = monthOf(today)`.
- `recent` and `before` are medians pooled over all rides in each span.
- Round `median`, `recent` and `before` to 3 decimals, and `change` to 3 decimals.

- [ ] **Step 1: Write the failing tests** (use a small `ride(date, np, hr, overrides?)` factory):
  - `excludes indoor rides, rides without heart rate, and rides under 30 minutes`: four rides in one month, only one qualifying, so `rides === 1`.
  - `takes the median for odd and even counts`: `median([1.0, 1.4, 1.2]) === 1.2` and `median([1.0, 1.2, 1.4, 1.6]) === 1.3`.
  - `leaves a month with fewer than 3 rides as null`: a month with 3 rides gets a number, and one with 2 gets `median === null, rides === 2`.
  - `keeps the month in progress out of the series`: with `today = '2026-10-25'`, October rides do not appear in `months`, and do appear in `thisMonth` with `month === '2026-10'`.
  - `compares the last three complete months with the three before`: 5 rides at EF 1.3 in Jul–Sep and 5 at 1.2 in Apr–Jun give `recent === 1.3`, `before === 1.2`, `change === 0.083`, and `recentSpan` deepEquals `['2026-07', '2026-09']`.
  - `gives no headline when either side has fewer than 5 rides`: `recent`, `before` and `change` are all null.
  - `crosses the year boundary in January`: `today = '2026-01-15'` gives `recentSpan ['2025-10', '2025-12']` and `beforeSpan ['2025-07', '2025-09']`.
  - `handles no rides at all`: `months` is `[]`, `thisMonth.rides === 0`, `rides === 0`, and the headline is null.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL on the missing module.
- [ ] **Step 3: Implement `efficiencyReading` and its helpers in `src/calc/performance.ts`.** Open the file with a header comment in the style of `form.ts`, saying why efficiency covers road rides only: indoor heart rate runs differently, and power with heart rate sits in two separate periods.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Create `docs/performance.md`** with an intro paragraph (load measures work, these measure capacity) and an "Efficiency" section: the rule, the data limits from the spec's "What the data allows", and a "What the tests pin down" list matching the test names.
- [ ] **Step 6: Commit**: "Measure efficiency on road rides by month".

---

### Task 3: Critical power by month

**Files:**
- Modify: `src/calc/performance.ts`, `src/calc/performance.test.ts`, `docs/performance.md`

**Interfaces:**
- Consumes: `monthOf` and `addMonths` from Task 2, and `addDays` from `load.ts`.
- Produces:
  - `export interface CurveEffort { activityId: number; date: string; durationS: number; watts: number }`: rides already filtered to `fit_file.status = 'parsed'` by the caller
  - `export interface FtpRide { date: string; watts: number }`, sorted by date
  - `export interface CriticalPowerMonth { month: string; cp: number | null; wPrimeJ: number | null; rides: number; garminFtp: number | null }`
  - `export interface Best { durationS: number; watts: number; date: string }`
  - `export interface CriticalPowerReading { months: CriticalPowerMonth[]; window: { from: string; to: string; bests: Best[] } }`
  - `export function fitCriticalPower(bests: readonly { durationS: number; watts: number }[]): { cp: number; wPrimeJ: number } | null`
  - `export function criticalPowerReading(efforts: readonly CurveEffort[], ftp: readonly FtpRide[], today: string): CriticalPowerReading`
- Constants, exported: `CP_DURATIONS_S = [120, 300, 600, 1200]`, `CP_WINDOW_DAYS = 90`, `CP_MIN_DURATIONS = 3`.

**Rules:** the spec's "Critical power" section.
- **The window** for an end date `e` holds efforts with `date > addDays(e, -90) && date <= e`. `window.from` is `addDays(today, -89)`, the first day included.
- **The month end** is the month's last day, or `today` for the month in progress.
- **Ties:** on equal watts, the earlier date is kept.
- **The fit:** ordinary least squares of `y = watts × t` on `x = t`. The slope is CP and the intercept is W′. Return null when fewer than `CP_MIN_DURATIONS` durations are present, or when `cp <= 0` or `wPrimeJ <= 0`.
- **Rounding:** `cp` to 1 decimal, `wPrimeJ` to the nearest joule.
- **`garminFtp`** is the `watts` of the last `FtpRide` with `date <= e`, else null.
- **The series** runs from `monthOf` of the earliest effort to `monthOf(today)`. Empty input gives `months: []`.

- [ ] **Step 1: Write the failing tests:**
  - `recovers CP and W′ from bests built on them`: bests `watts = 250 + 20000 / t` at the four durations give `cp === 250` and `wPrimeJ === 20000`.
  - `needs three durations`: two bests give `null`.
  - `refuses a fit with no anaerobic capacity`: bests with `watts = 200 - 3000 / t` give `null`.
  - `keeps a ride 89 days old and drops one 90 days old`: `today = '2026-10-25'`. An effort on `addDays(today, -89)` counts toward `window.bests`, and one on `addDays(today, -90)` does not.
  - `takes Garmin's FTP on or before the month's end`: FTP rides `2026-08-10: 230` and `2026-09-05: 237` give `237` for Sep. A month before the first FTP ride gets `garminFtp === null`.
  - `leaves months with too little in the window as null`: one ride on 2024-01-15 holds all four durations, and `today = '2024-10-25'`. Jan–Mar have a `cp`. From April onward `cp` is null, because 30 April minus 90 days is 31 January. The `months` array still runs through October.
  - `counts distinct rides in the window`: two durations from one ride and one from another give `rides === 2`.
  - `handles no efforts`: `months` is `[]` and `window.bests` is `[]`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `fitCriticalPower` and `criticalPowerReading`.** Use a doc comment that names the two-parameter model and says it only knows efforts actually ridden.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Add a "Critical power" section to `docs/performance.md`**: the model, the window, why it reads low without hard efforts (November 2023, 110 W), and what the tests pin down.
- [ ] **Step 6: Commit**: "Fit critical power to the stored curves".

---

### Task 4: Ramp rate against the rider's own weeks

**Files:**
- Modify: `src/calc/performance.ts`, `src/calc/performance.test.ts`, `docs/performance.md`

**Interfaces:**
- Consumes: `flooredPercentile`, `countAtOrBelow`, `fifthOf` and `lastBeforeRun` from Task 1, and `addDays` from `load.ts`.
- Produces:
  - `export interface RampDay { date: string; fitness: number; isWarmup: boolean; isEstimated: boolean }`
  - `export type RampBand = 'lowest' | 'low' | 'middle' | 'high' | 'highest'`
  - `export interface RampPosition { date: string; perWeek: number; percentile: number; percentAbove: number; band: RampBand; lastInBand: string | null; estimated: boolean }`
  - `export function rampPosition(days: readonly RampDay[]): RampPosition | null`

**`percentAbove`** is the floored share of measured days with a strictly higher ramp. It is not in the spec's API listing, but the spec's caption rule needs it ("Steeper fall than {q}%"), so it is added to the response.

**Rules:**
- Look up `d − 7` by date with a `Map`. A day is measured only when both `d` and `d − 7` exist and neither is warm-up.
- `perWeek` is rounded to 2 decimals.
- `lastInBand` uses `lastBeforeRun` over the measured days' bands.
- The function returns null when no day is measured.

- [ ] **Step 1: Write the failing tests** (reuse the `spine` idea from `form.test.ts`, with fitness values):
  - `takes the seven-day difference`: fitness rising by 1 a day gives `perWeek === 7` on the last day.
  - `skips days whose week-earlier day is warm-up`: a 14-day spine with indices 0–3 as warm-up leaves only indices 11, 12 and 13 measured, since their `d − 7` is 4, 5 and 6. Set fitness so those three ramps are 1, 2 and 3. Then the last day's `percentile === 66` (2 of 3 below, floored).
  - `floors the percentile and reports the share above`: with known ramps, check `percentile` and `percentAbove` exactly.
  - `finds the last spell in the same fifth, not yesterday`: build a ramp series lowest → middle → lowest. `lastInBand` is the last date of the first lowest spell.
  - `carries the estimated flag of the latest day`.
  - `returns null on a history no longer than the warm-up plus a week`: 45 days with 42 warm-up give `null`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `rampPosition`.** The doc comment says it is placed against the rider's own weeks because generic ramp limits are in TSS, a different scale.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Add a "Ramp rate" section to `docs/performance.md`**, linking to `load-model.md` for fitness.
- [ ] **Step 6: Commit**: "Place the ramp rate against the rider's own weeks".

---

### Task 5: The report and `GET /api/performance`

**Files:**
- Modify: `src/calc/performance.ts`, `src/calc/performance.test.ts`, `src/calc/load.ts` (`powerCurveHeldBack`), `src/server.ts`, `docs/api.md`

**Interfaces:**
- Consumes: everything Tasks 2–4 produce.
- Produces:
  - `export interface PerformanceReport { efficiency: EfficiencyReading; criticalPower: CriticalPowerReading; ramp: RampPosition | null; heldBack: number; formula: { efficiency: string; criticalPower: string; ramp: string } }`
  - `export function performanceReport(database: Database.Database = db(), todayIso: string = today()): PerformanceReport`
  - `powerCurveHeldBack(sinceDate?: string, untilDate?: string, database: Database.Database = db()): number`: a new last parameter, with existing callers unchanged

**Queries:**
- Efficiency: `activity` rows with `normalized_power IS NOT NULL`, mapped to `EfficiencyRide`.
- Efforts: `power_curve` joined to `activity` and to `fit_file` with `status = 'parsed'`, with `duration_s IN (120, 300, 600, 1200)`.
- FTP: `activity` rows with `ftp_at_ride IS NOT NULL ORDER BY local_date`.
- Ramp: `daily_load` ordered by date.
- Held back: `powerCurveHeldBack(undefined, undefined, database)`.

**Formula strings, exactly:**
- `efficiency: 'median of normalized power / average heart rate, road rides with at least 30 min moving, by month'`
- `criticalPower: 'least-squares fit of work = CP·t + W′ to the 90-day bests at 2, 5, 10 and 20 min'`
- `ramp: 'fitness(d) − fitness(d − 7), ranked against every measured day'`

- [ ] **Step 1: Write the failing test** `leaves a held-back ride out of critical power and counts it`. Use `openDatabase(':memory:')` and insert two road rides in the window:
  - Each needs `activity_id`, `activity_type`, `start_time_local`, `local_date` and `imported_at`.
  - Ride A has `fit_file.status = 'parsed'` and 20 min at 240 W.
  - Ride B has `fit_file.status = 'pending'` and 20 min at 400 W.

  Assert that `report.criticalPower.window.bests` holds 240 for 1200 s, and that `report.heldBack === 1`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `performanceReport`, and add the `database` parameter to `powerCurveHeldBack`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: In `src/server.ts`, add `app.get('/api/performance', (c) => c.json(performanceReport()))`.** Leave `/api/ftp` alone: Trends still calls it until Task 7.
- [ ] **Step 6: Check against the real database.** Start the API (`npm run server`) and fetch `http://localhost:8787/api/performance` with Node's `fetch`. Expected values, from the spec's last table:
  - `efficiency.rides` is 84.
  - `recent` ≈ 1.286, `before` ≈ 1.194, `change` ≈ 0.077.
  - The latest `criticalPower.months` entry has `cp` ≈ 228, `wPrimeJ` ≈ 21500, `rides` 34 and `garminFtp` 237.
  - `ramp.perWeek` ≈ −6.93, with `percentile` 6.
  - `heldBack` is 0.
- [ ] **Step 7: Update `docs/api.md`.** Add a `GET /api/performance` section in the existing format, with fields and an example.
- [ ] **Step 8: Run `npm test && npm run typecheck`, then commit**: "Serve the performance report".

---

### Task 6: The Performance screen

**Files:**
- Create: `web/src/views/Performance.tsx`
- Modify: `web/src/api.ts` (types mirroring `PerformanceReport`), `web/src/App.tsx` (`VIEWS`, route), `docs/interface.md` (screens table plus a short Performance paragraph), `README.md` (screens table, plus a "**Measures performance**" paragraph after "Places today's form"), `docs/plan.md` (a "Three projects, 25 October 2026" subsection under milestone 4, with Performance marked built)

**Interfaces:**
- Consumes: the `/api/performance` response, typed as `PerformanceReport` in `web/src/api.ts`, with field names identical to Task 5's.
- Produces: `export function Performance()`, and an exported `performanceFinding(report: PerformanceReport): ReactNode` kept in the same file.

**Layout and copy:** the spec's "The screen" section, exactly.
- Rows are `grid-1-1-1`, then `grid-2-1`, then `grid-2-1`.
- The subtitle is the finding.
- **Best power by season:** copy the card from Trends into row 2, right cell, unchanged. It brings along its two `useApi` power-curve calls, `PEAK_DURATIONS`, `peakAt` and the held-back note. Trends keeps its copy until Task 7 deletes it, so neither screen has an empty cell between commits.
- **Labels:**
  - The critical power chart's x labels use `monthYear(month + '-01')`.
  - The in-progress month's tooltip label is `` `to ${shortDate(window.to)}` ``.
  - The efficiency chart has no in-progress point. Its note carries "This month so far: …".
- **Captions:**
  - Critical power uses `Delta`, with `tone="good"` when above Garmin's figure, `"even"` when below, and no comparison at all when `garminFtp` is null.
  - Efficiency uses `Delta`, good when up and bad when down.
- **The ramp card** has `aside={shortDate(ramp.date)}`, and appends "· less sure" when `estimated`.

- [ ] **Step 1: Add the types to `api.ts`, the view, and the `VIEWS` entry** `{ id: 'performance', label: 'Performance' }` between `trends` and `activities`, plus its render line.
- [ ] **Step 2: Run `npm run typecheck`.** Expected: PASS.
- [ ] **Step 3: Check it in the browser.** Run `npm run dev` and open `http://localhost:5273/#performance` at 1440, 900 and 375 px wide. Check that:
  - The finding reads "Efficiency is up 8% on the three months before: 1.29 watts per beat against 1.19."
  - The KPIs read 228 W, 1.29 and −6.9.
  - The rows end level at 1440.
  - Nothing scrolls sideways at 375.
- [ ] **Step 4: Check the empty state.** Point `DATABASE_PATH` (see `.env.example`) at a fresh file, restart, and confirm every card shows its frame and one sentence, and that the finding is rule 4. Then restore the setting.
- [ ] **Step 5: Update `docs/interface.md`, `README.md` and `docs/plan.md` as listed under Files.**
- [ ] **Step 6: Commit**: "Add the Performance screen".

---

### Task 7: Slim Trends and repoint Overview

**Files:**
- Modify: `web/src/views/Trends.tsx`, `web/src/views/Overview.tsx`, `web/src/api.ts` (delete `FtpStep`), `src/server.ts` (delete `/api/ftp`), `docs/api.md` (delete its section), `docs/interface.md` (Trends shape)

**Changes:** the spec's "Changes elsewhere" section.
- Delete Trends' copy of Best power by season, which now lives on Performance after Task 6, along with its helpers.
- Delete the Threshold power card, the `ftp` call, `ftpByDay`, `ftpNow` and `ftpThen`.
- Delete the `/api/ftp` route and its `docs/api.md` section. Nothing calls it any more.
- The Form row becomes `grid-2-1`: Form on the left, and on the right a `<div className="column">` holding Rides by type and Rides the model cannot trust.
- Delete the `grid-1-1-1` row.
- The subtitle becomes `` `Training load over ${range.phrase}.` `` The component's doc comment becomes "how has the load moved over this period?".
- Remove imports nothing uses any more. Typecheck will flag them.
- Overview: change the Best power held card's `foot` to `<More href="#performance">Power by season</More>`.

- [ ] **Step 1: Make the changes.**
- [ ] **Step 2: Run `npm run typecheck && npm test`.** Expected: PASS.
- [ ] **Step 3: Check it in the browser at 1440, 900 and 375 px.** On Trends, the Form row ends level with the stacked column, the page ends with Season by season and Biggest weeks, and no `/api/ftp` request appears in the network log. On Overview, the Best power held footer opens Performance.
- [ ] **Step 4: Update the Trends row in `docs/interface.md`'s screens table** to the new shape and question.
- [ ] **Step 5: Commit**: "Move power off Trends and onto Performance".

---

### Task 8: Whole-branch check

- [ ] **Step 1: Run `npm test && npm run typecheck`.** Expected: PASS, with the test count higher than 49.
- [ ] **Step 2: Check every row of the spec's "Expected values on 25 October 2026" table** against the running screen. Note any difference, along with its cause, in the final report. Do not change a rule to make a number match.
- [ ] **Step 3: Grep for anything left behind.** `grep -rn "api/ftp\|FtpStep\|Threshold power" src web docs README.md` should find nothing except history in `docs/superpowers/`.
- [ ] **Step 4: Confirm `git status` is clean and `git log master..` shows the spec commit plus one commit per task.**
