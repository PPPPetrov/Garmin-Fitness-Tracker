# Planning ahead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Planning screen that projects form and fitness forward to a date the rider
chooses, under a two-phase scenario expressed as a share of the rider's usual load.

**Architecture:** The projection appends assumed days to the same per-day input map that
`recomputeDailyLoad` builds and runs the same `computeLoadSeries`, so the formula exists in one
place. A single saved plan lives in a new `plan` table. Three routes sit in their own Hono
sub-app so they can be tested with `app.request()`. A new React view reads them.

**Tech Stack:** TypeScript, Hono, better-sqlite3, node:test via `tsx --test`, React 18 + Vite,
hand-drawn SVG charts.

**Spec:** [`docs/superpowers/specs/2026-10-25-planning-ahead-design.md`](../specs/2026-10-25-planning-ahead-design.md).
Read it before any task. Its "Expected values" table is the end-to-end check.

## Global Constraints

- Nothing tells the rider what to ride. Every sentence about a scenario is conditional ("If
  you …"). There is no suggested scenario, target form or "optimal" anything.
- The projection is never written to `daily_load`. `recompute` and sync never touch `plan`.
- `FORMULA_VERSION` is unchanged (`ewma-atl7-ctl42-v1`), because the maths does not change.
- Percentages are one of `0, 25, 50, 75, 100, 125, 150`.
- An event is from tomorrow to 180 days ahead. A switch is from today to the event,
  inclusive. A name has at most 60 characters.
- The usual load is the 28 complete days ending yesterday. The default scenario is rest from
  today for 28 days. The chart shows 42 days of history.
- A missing value is `DASH` from `web/src/format.ts`, never `0` or `--`.
- Sync is the only filled button. Save is `.btn-quiet`.
- The fitness change on a projection is grey either way. Do not use `Delta`'s good or bad
  tone.
- Card titles of projected KPIs start with "Projected".
- "Today" is `today()` from `src/calc/load.ts` everywhere, as on the other screens.
- Code and docs are in English and follow the comment style of the surrounding files.

## Review Focus

1. **A ride synced today.** Today is the first projected day, but a synced ride is history.
   A projected-range day that already has a synced ride keeps its measured load, gets
   `projected: false`, and gets no scenario load on top. Pinned in Task 2.
2. **Controls left invalid mid-edit.** Examples: an event date before the switch, or an
   emptied date field. The screen must keep the last good projection, show the 400's
   sentence in the Scenario card, and send no `PUT`. Pinned in Task 4 (route) and Task 7
   (no save while invalid).
3. **Nothing synced yet.** An empty `activity` table returns `null` from `GET`, not a 500.
   Every card keeps its frame. Pinned in Task 3.
4. **A saved event that has just passed.** On the event day itself there is nothing left to
   project, so the default is projected with `past: null`, because the spec sets `past`
   only for a date before today. From the day after, `past` is set. Neither case may throw.
   Pinned in Task 3.
5. **Malformed query strings.** Examples: `before=abc`, `event=2026-13-40`, or a scenario
   given only half its parameters. Each is a 400 naming the parameter, never a 500 and never
   a silent fall back to the saved plan. Pinned in Task 4.

---

### Task 1: Share the per-day inputs and the form placement

Two small refactors that the projection reuses, so nothing is copied.

**Files:**
- Modify: `src/calc/load.ts` (extract the query out of `recomputeDailyLoad`)
- Modify: `src/calc/form.ts` (extract the percentile, band and rank of one form value)
- Test: `src/calc/load.test.ts`, `src/calc/form.test.ts`

**Interfaces:**
- Produces:
  - `dailyInputs(database?: Database.Database): { from: string; perDay: Map<string, DayInput> } | null`
    in `load.ts`. It is the existing `SELECT … GROUP BY local_date` with `UNRELIABLE_LOAD_SQL`.
    It returns `null` when `activity` is empty. `recomputeDailyLoad` calls it.
  - `placeForm(sorted: readonly number[], form: number): { percentile: number; band: FormBand; rank: number }`
    in `form.ts`. `sorted` is ascending. `formPosition` calls it, so its output is unchanged.
  - `measuredForms(database?: Database.Database): number[]` in `form.ts`. It returns the
    ascending forms of non-warm-up `daily_load` rows.

- [ ] **Step 1: Write the failing tests**

In `load.test.ts`: seed `openDatabase(':memory:')` with two rides on one day (loads 40 and
60, one with `avg_hr` null and `duration_s` 3600) and one ride a day later. Then assert:
- `dailyInputs(db)!.perDay.get(day)` equals `{ load: 100, rides: 2, unmeasured: 1 }`;
- `from` is the first day;
- `dailyInputs(openDatabase(':memory:'))` is `null`.

In `form.test.ts`: on `sorted = [-20, -10, 0, 10, 20]`, `placeForm(sorted, 10)` gives
`{ percentile: 60, band: 'fresh', rank: 2 }`. The existing `formPosition` tests must pass
unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/calc/load.test.ts src/calc/form.test.ts`
Expected: FAIL, `dailyInputs` / `placeForm` is not exported.

- [ ] **Step 3: Implement both, and switch `recomputeDailyLoad` and `formPosition` to use them**

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/calc/load.ts src/calc/load.test.ts src/calc/form.ts src/calc/form.test.ts
git commit -m "Share the per-day load inputs and the placement of one form value"
```

---

### Task 2: The projection, as pure functions

**Files:**
- Create: `src/calc/planning.ts`
- Test: `src/calc/planning.test.ts`

**Interfaces:**
- Consumes: `computeLoadSeries`, `addDays`, `DayInput` from `load.ts`; `placeForm` and
  `FormBand` from `form.ts`.
- Produces (all exported from `planning.ts`):

```ts
export const PERCENT_STEPS = [0, 25, 50, 75, 100, 125, 150] as const;
export const USUAL_WINDOW_DAYS = 28;
export const HISTORY_SHOWN_DAYS = 42;
export const MAX_HORIZON_DAYS = 180;
export const DEFAULT_REST_DAYS = 28;
export const NAME_MAX_LENGTH = 60;

export interface Scenario { eventDate: string; switchDate: string; beforePct: number; afterPct: number }
export interface Usual { perDay: number; perWeek: number; rides: number; unmeasured: number; from: string; to: string }
export interface ProjectedDay { date: string; fitness: number; fatigue: number; form: number; projected: boolean; estimated: boolean }
export interface Projection {
  start: { date: string; fitness: number; fatigue: number; form: number };
  usual: Usual;
  series: ProjectedDay[];   // HISTORY_SHOWN_DAYS before today, then today … eventDate
  event: { date: string; form: number; fitness: number; fitnessChange: number;
           percentile: number; band: FormBand; rank: number; measuredDays: number };
  turnsPositive: string | null;
  peak: { date: string; form: number; fitness: number };
  switchDay: { date: string; form: number; fitness: number };
}

export function usualLoad(perDay: ReadonlyMap<string, DayInput>, from: string, today: string): Usual;
export function scenarioLoad(scenario: Scenario, usualPerDay: number, date: string): number;
export function defaultScenario(today: string): Scenario;
/** One sentence naming the first thing wrong, or null. `name` is checked when given. */
export function scenarioError(scenario: Scenario, today: string, name?: string | null): string | null;
export function project(
  perDay: ReadonlyMap<string, DayInput>, from: string, today: string,
  scenario: Scenario, sortedForms: readonly number[],
): Projection;
```

Decisions the signatures leave open:
- **`usualLoad`.**
  - The window is `max(from, today − 28) … today − 1`. `perDay` is the sum of load over that
    window divided by the number of days in it.
  - `rides` and `unmeasured` are summed over the window. `perWeek = perDay × 7`.
  - Values are rounded to two decimals only in the returned object.
- **`scenarioLoad`.** For a date before `switchDate` it is `beforePct / 100 × usualPerDay`.
  From `switchDate` on it is `afterPct / 100 × usualPerDay`.
- **`project`.**
  - Copy `perDay`. For every date from `today` to `eventDate − 1` **with no entry**, set
    `{ load: scenarioLoad(…), rides: 0, unmeasured: 0 }`. A date that has an entry keeps it
    (Review Focus 1).
  - Run `computeLoadSeries(copy, from, eventDate)`. The event day has no entry, so its own
    load is 0. Its `form` is `fitness(eve) − fatigue(eve)`, by construction.
  - Event-day `fitness` is the eve's stored fitness (the row before the event row), as the
    spec says. `fitnessChange` is that minus `start.fitness`.
  - `start` is the series row for `today − 1`. Its `form` is the form carried into today,
    which is today's row's `form`.
  - A row is `projected` when its date is ≥ `today` and it is not in the original `perDay`.
    `estimated` is the row's `isEstimated`.
  - The rank, percentile and band come from `placeForm(sortedForms, eventForm)`, and
    `measuredDays` is `sortedForms.length`.
  - `turnsPositive`: when the form carried into today is < 0, the first date ≥ today with
    form ≥ 0, up to the event day. Otherwise null.
  - `peak`: the highest form from today to the event day inclusive. The earliest wins a tie.
    Its `fitness` is the fitness on the eve of that day, matching the event-day convention.
  - `switchDay` uses the same convention, on `switchDate`.
  - Every number in the result is rounded to two decimals.
- **`scenarioError`.** It checks, in this order, and the message names the field:
  1. dates are valid `YYYY-MM-DD` calendar dates;
  2. `eventDate` > `today`;
  3. `eventDate` ≤ `today + 180`;
  4. `today` ≤ `switchDate` ≤ `eventDate`;
  5. both percentages are in `PERCENT_STEPS`;
  6. `name` is at most 60 characters.

  Example: "The event date must be after today."

- [ ] **Step 1: Write the failing tests**

Use a small helper `history(days: Record<string, number>)` that builds a `perDay` map.
`TODAY = '2026-10-25'`.

- `project` / history:
  - The rows before `today` equal `computeLoadSeries(perDay, from, today − 1)` row for row
    (fitness, fatigue, form).
  - The projection does not mutate the input map.
- `project` / rest:
  - With `afterPct: 0` and `switchDate: TODAY`, each projected day's fitness is
    `prev × 41/42` and fatigue is `prev × 6/7`, within 0.01.
- `project` / steady:
  - From a history of 400 days at load 50, a 100% scenario keeps fitness and fatigue within
    0.05 of 50 through the event.
- `project` / event day:
  - `event.form` equals `fitness(eve) − fatigue(eve)` from the series.
  - Changing the load on the event date in the input changes nothing in `event`.
- `project` / switch:
  - With `beforePct: 100`, `afterPct: 0` and `switchDate = TODAY + 3`, the load fed on
    `TODAY + 2` is the usual, and on `TODAY + 3` it is 0. Check through the fitness step:
    `Δfitness = (load − prev) / 42`.
- `project` / switch today:
  - When `switchDate === TODAY`, no projected day gets `beforePct`.
- `project` / synced today:
  - A `perDay` entry on `TODAY` (load 120) keeps load 120. That row has `projected: false`
    and `TODAY + 1` has `projected: true`.
- `usualLoad`:
  - Over 28 days, a load of 70 on `TODAY − 1` and 1000 on `TODAY` gives `perDay` 2.5.
    Today is not in it.
  - Its `unmeasured` count sums the window.
  - A history of 10 days divides by 10 and reports `from` and `to`.
- `turnsPositive`:
  - It is null when the form carried into today is ≥ 0.
  - It is a date when a tired state crosses zero under rest.
  - It is null when a 150% scenario never crosses.
- `peak`:
  - On a plateau of equal forms, the earliest date wins.
- Placement:
  - `event.percentile` and `event.rank` equal `placeForm(sortedForms, event.form)`.
  - `measuredDays === sortedForms.length`, so projected days are not counted.
- `estimated`:
  - With an unmeasured ride on `TODAY − 2`, projected days are `estimated` through
    `TODAY + 39` and not on `TODAY + 40`.
- `scenarioError`:
  - Each of the following returns a sentence: an event on TODAY, an event at TODAY + 181,
    a switch before TODAY, a switch after the event, `beforePct: 30`, `eventDate:
    '2026-13-40'`, and a 61-character name.
  - The default scenario and an event at TODAY + 180 return null.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/calc/planning.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `planning.ts` to the interfaces above**

The module comment says what the projection is and is not, in the voice of `form.ts`: same
arithmetic, assumed load, not advice.

- [ ] **Step 4: Run them to see them pass**

Run: `npx tsx --test src/calc/planning.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calc/planning.ts src/calc/planning.test.ts
git commit -m "Project form and fitness forward under a two-phase scenario"
```

---

### Task 3: The plan table and the report

**Files:**
- Modify: `src/db/schema.sql` (append the `plan` table exactly as in the spec's Storage
  section, with a one-line comment that it holds what the rider typed)
- Modify: `src/calc/planning.ts` (add the database half)
- Test: `src/calc/planning.test.ts`

**Interfaces:**
- Consumes: `dailyInputs` and `today` (Task 1, `load.ts`), `measuredForms` (Task 1), and
  `project`, `defaultScenario`, `Scenario`, `Projection` (Task 2).
- Produces:

```ts
export interface SavedPlan extends Scenario { name: string | null }
export interface PlanningReport extends Projection {
  plan: SavedPlan | null;
  scenario: Scenario & { source: 'saved' | 'query' | 'default' };
  past: string | null;
  formula: string;            // FORMULA_VERSION
}
export function readPlan(database?: Database.Database): SavedPlan | null;
export function savePlan(plan: SavedPlan, database?: Database.Database): void;   // upsert id = 1, sets updated_at
export function clearPlan(database?: Database.Database): void;
export function planningReport(
  query: Scenario | null, database?: Database.Database, today?: string,
): PlanningReport | null;
```

Which scenario is projected:
1. `query` when it is given (`source: 'query'`).
2. Otherwise the saved plan, when `eventDate > today` (`source: 'saved'`).
3. Otherwise `defaultScenario(today)` (`source: 'default'`).

`past` is the saved `eventDate` when it is `< today`, and null otherwise. A saved plan whose
event is today projects the default with `past: null`. `planningReport` returns null when
`dailyInputs` is null. It does not validate `query`; the route does that.

- [ ] **Step 1: Write the failing tests**

Each test uses its own `openDatabase(':memory:')`, seeded with rides through `INSERT INTO
activity`, as `load.test.ts` does. `recomputeDailyLoad` always uses `db()`, so a test helper
fills `daily_load` itself: it runs `computeLoadSeries` over `dailyInputs(database)` and
inserts the rows. Do not widen `recomputeDailyLoad` for the test. Call the code under test
with an explicit `today`.
- With no rides, `planningReport(null, db, TODAY)` is `null`.
- With no plan, `scenario.source` is `'default'`, `scenario.eventDate` is `TODAY + 28` and
  `afterPct` is 0.
- `savePlan` then `readPlan` round-trips every field, including `name: null`. A second
  `savePlan` replaces the first, and `SELECT COUNT(*) FROM plan` is 1.
- With a saved future plan, `source` is `'saved'`.
- With a saved plan at `TODAY − 1`, `past` is `TODAY − 1` and `source` is `'default'`. With
  one at `TODAY`, `past` is null and `source` is `'default'`.
- A query overrides a saved plan: `source` is `'query'` and `plan` is still the saved row.
- `clearPlan` leaves `readPlan` null.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/calc/planning.test.ts`
Expected: FAIL, `planningReport` is not exported.

- [ ] **Step 3: Add the table and implement the five functions**

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/calc/planning.ts src/calc/planning.test.ts
git commit -m "Store one plan and report its projection"
```

---

### Task 4: The routes

**Files:**
- Create: `src/routes/planning.ts`
- Modify: `src/server.ts` (mount it: `app.route('/api/planning', planningRoutes())`)
- Test: `src/routes/planning.test.ts`
- Modify: `docs/api.md` (one section per route, before `## Errors`, in the existing style)

**Interfaces:**
- Consumes: `planningReport`, `readPlan`, `savePlan`, `clearPlan`, `scenarioError`,
  `SavedPlan` (Task 3), and `today` from `load.ts`.
- Produces: `planningRoutes(getDb?: () => Database.Database, getToday?: () => string): Hono`.
  The defaults are `db` and `today`. The tests pass an in-memory database and a fixed day.

Behaviour:
- **`GET /`**
  - With none of `event`, `switch`, `before` or `after`, it calls `planningReport(null)`.
  - With all four, it parses them into a `Scenario`, using `Number()` for the percentages,
    and returns 400 `{ error }` when `scenarioError` gives a sentence. Otherwise it calls
    `planningReport(scenario)`.
  - With some but not all four, it returns 400: "Give event, switch, before and after
    together."
  - It returns the report, or `null` with 200 when there is no history.
- **`PUT /`**
  - Without `Content-Type: application/json` it returns 415 `{ error: 'Send the plan as
    JSON.' }`.
  - A body that does not parse, or a field of the wrong type, returns 400.
  - `name` is trimmed and an empty name becomes null. `scenarioError(…, name)` gives 400.
  - Otherwise it saves and returns `planningReport(null)`.
- **`DELETE /`** clears the plan and returns 204.

- [ ] **Step 1: Write the failing tests**

Call `planningRoutes(() => database, () => TODAY).request(path, init)`.
- `GET /` with no history returns 200 and the body `null`.
- `GET /?event=…&switch=…&before=50&after=0` returns 200 with `scenario.source === 'query'`.
  Nothing is saved: `readPlan` is null.
- `GET /?before=abc&after=0&event=…&switch=…` returns 400 and the error mentions "before".
  `event=2026-13-40` returns 400. `?event=…` alone returns 400.
- `PUT` with `Content-Type: application/x-www-form-urlencoded` returns 415.
- `PUT` with a valid JSON plan returns 200 and `plan.name === 'Gran fondo'`. A following
  `GET /` has `source === 'saved'`.
- `PUT` with `afterPct: 30` returns 400, and the earlier saved plan is unchanged.
- `DELETE` returns 204. A following `GET /` has `plan === null` and `source === 'default'`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/routes/planning.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement the routes, mount them, and document them in `docs/api.md`**

The `api.md` sections show the response shape from the spec's API section, the query
parameters, the three status codes, and that a query projects without saving.

- [ ] **Step 4: Run the suite and the test glob**

Run: `npm test && npm run typecheck`
Expected: PASS. `src/routes/planning.test.ts` is picked up by `src/**/*.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/routes src/server.ts docs/api.md
git commit -m "Add the planning routes"
```

---

### Task 5: The copy

**Files:**
- Modify: `web/src/api.ts` (types plus three calls)
- Create: `web/src/views/planningCopy.ts`
- Test: `web/src/views/planningCopy.test.ts`

**Interfaces:**
- Produces, in `web/src/api.ts`:
  - The types `PlanScenario`, `SavedPlan`, `PlanningReport` and `PlanningDay`, mirroring
    Tasks 2–3 field for field. Reuse the existing `FormBand`.
  - `planningPath(s: PlanScenario | null): string`. It returns `'/api/planning'`, or the
    URL with all four query parameters.
  - `savePlan(plan: SavedPlan): Promise<PlanningReport>` and `clearPlan(): Promise<void>`.
    On a non-2xx response both throw `Error(body.error ?? statusText)`, so the card can show
    the server's sentence.
- Produces, in `planningCopy.ts`:

```ts
export function phaseText(pct: number): string;            // 0 'rest', 50 'ride half your usual', 100 'ride your usual', else 'ride {pct}% of your usual'
export function scenarioClause(s: PlanScenario, today: string): string;
export function planningFinding(r: PlanningReport, today: string): string;
export function formCaption(e: PlanningReport['event']): string;
export function pointsText(pct: number, perWeek: number): string;   // '50% = 229 a week'
```

`scenarioClause` gives:
- "If you rest from today" when the switch is today and the after phase is 0;
- "If you ride half your usual from 19 Nov" when the before phase is 100 and the switch is
  later. The rule: when `beforePct` is 100, name only the after phase and the switch date;
- otherwise "If you {before} until {switch − 1}, then {after}".

`planningFinding` uses the spec's three sentences exactly. A rest scenario uses the peak
sentence. Any other scenario uses the event sentence. The past case prefixes "Your event on
{date} has passed. ". Dates use `shortDate` from `format.ts`.

`formCaption`:
- "Fresher than {percentile}% of your days" when `form` ≥ 0;
- otherwise "More tired than {⌊100 × (rank − 1) / measuredDays⌋}% of your days".

- [ ] **Step 1: Write the failing tests**

They use the spec's expected values:
- `phaseText` for 0, 50, 100 and 75.
- `pointsText(50, 458.28)` is `'50% = 229 a week'`.
- The taper report (event 2026-11-29, switch 2026-11-19, 100 then 50, event form 23.28,
  percentile 91, fitness 62.99, change −13.01) gives "If you ride half your usual from 19
  Nov, form on 29 Nov is +23.3, fresher than 91% of your days, with fitness 63.0, 13.0
  under yesterday."
- The default rest report (peak +47.66 on 2026-11-06, fitness 56.92) gives "If you rest from
  today, form peaks at +47.7 on 6 Nov, and fitness falls to 56.9 by then."
- With `past: '2026-10-20'`, the sentence starts "Your event on 20 Oct has passed. ".
- `formCaption` with form −5, rank 801 and measuredDays 1000 gives "More tired than 80% of
  your days".

Build each report as a literal with only the fields read. Check `shortDate`'s actual output
format and match it in the expectations.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test web/src/views/planningCopy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the api types and calls and `planningCopy.ts`**

- [ ] **Step 4: Run them**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/views/planningCopy.ts web/src/views/planningCopy.test.ts
git commit -m "Add the planning API client and its copy"
```

---

### Task 6: Pale projected segments in the line chart

**Files:**
- Modify: `web/src/charts/Line.tsx`

**Interfaces:**
- Produces: `Series` gains `paleFrom?: number` and `paleColour?: string`. From index
  `paleFrom` onwards the series is drawn in `paleColour`. The two paths share the point at
  `paleFrom`, so the line is continuous. Without `paleFrom`, nothing changes.

- [ ] **Step 1: Implement it**

Draw the series as two `path()` calls, over `values` with indices > `paleFrom` set to null,
and with indices < `paleFrom` set to null. The hover ring uses the colour of the segment the
hovered index is in.

- [ ] **Step 2: Check no other chart changed**

Run: `npm run typecheck`, then open Overview, Trends and Performance in the browser
(`npm run dev`). Expected: identical lines.

- [ ] **Step 3: Commit**

```bash
git add web/src/charts/Line.tsx
git commit -m "Let a line chart draw its projected part in the pale step"
```

---

### Task 7: The Planning screen

**Files:**
- Create: `web/src/views/Planning.tsx`
- Modify: `web/src/App.tsx` (a `VIEWS` entry `{ id: 'planning', label: 'Planning' }` between
  performance and activities, a `NavIcon` branch, and the route)
- Modify: `web/src/app.css` (only what is missing; see below)
- Modify: `web/src/api.ts` (`get()` reads the 400's `error` sentence)

**Interfaces:**
- Consumes: `useApi`, `planningPath`, `savePlan`, `clearPlan` and the types (Task 5); the
  copy functions (Task 5); `LineChart` with `paleFrom` (Task 6); `Card`; and `DASH`, `num`,
  `signed` and `shortDate` from `format.ts`.

Build it to the spec's "The screen" section: the layout table, every card, the ⓘ texts and
the states. The decisions the spec leaves to the implementer:
- **State.**
  - `draft: SavedPlan` starts from `report.plan`, or from `report.scenario` when there is no
    plan.
  - Every control edit sets `draft`. A 250 ms debounce turns `draft` into `path =
    planningPath(draft)`, which `useApi(path, [path])` reads.
  - The last `ready` report is kept in a ref and rendered while the next one loads, so the
    page shows skeletons only on first load.
  - "Not saved" shows when `draft` differs from `report.plan` in any field. With no plan,
    any draft is unsaved.
- **Invalid controls.** When `useApi` is in error, the Scenario card shows the server's
  sentence under the controls and the other cards keep the last good report. Save is
  disabled while the latest `GET` is an error. To surface the sentence, `get()` in `api.ts`
  reads `body.error` on a 400 before falling back to the status text.
- **Save** calls `savePlan(draft)`. On success the new report becomes the shown one. On
  failure the sentence sits in the Scenario card. **Clear plan** calls `clearPlan()` and
  then reloads `planningPath(null)`.
- **Chart.**
  - The labels are the series dates.
  - Form is in `var(--chart-1)` with `paleColour: 'var(--accent-200)'`. Fitness is in
    `var(--chart-2)` with `paleColour: 'var(--border)'`.
  - `paleFrom` is the index of the first `projected` row.
  - The annotations are "today" at today's index, the after phase as "{afterPct}%" at
    `switchDate` (left out when it is today), and the event name or "event" at the last
    index.
  - Draw zero with the existing baseline rule. The `tipLabels` add " · projected" on
    projected days.
- **Controls.**
  - The name is a `.field` with `maxLength={60}`.
  - The dates are `.field type="date"` with `min`/`max` set from today and the event date.
  - The phases are `.seg` with seven buttons. The existing `.seg` does not fit seven
    options in 366 px, so add a `.seg-fill` modifier: `display: flex; width: 100%`, with
    `flex: 1` and `padding: 0` on its buttons. Use only existing tokens.
  - `pointsText` goes under each phase.
- **KPI tones.** The fitness change is plain `--muted` text, never `Delta`. "· less sure" is
  appended when the event row is `estimated`.

- [ ] **Step 1: Build the view, the route and the icon**

The icon is a 16 × 16 stroke icon in `NavIcon`'s style: a flag on a pole, with a one-line
comment like the others.

- [ ] **Step 2: Typecheck and test**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Check it in the browser against the spec's expected values**

Run `npm run dev` and open `#planning`.
- With no plan, the finding is the default rest sentence: "+47.7 on 6 Nov … 56.9".
- Set event 29 Nov, switch 19 Nov, 100 then 50. The finding and KPIs match the taper row
  (+23.3, 91%, 63.0, 13.0 under).
- Save and reload: the plan is still there. Clear plan returns to the default.
- Set the switch after the event: the sentence appears in the Scenario card, the chart keeps
  the last good projection, and Save is disabled.
- At 1440, 900 and 375 px: rows end level at 1440, the seven segments stay on one line at
  375, and there is no horizontal page scroll.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/Planning.tsx web/src/App.tsx web/src/app.css web/src/api.ts
git commit -m "Add the Planning screen"
```

---

### Task 8: Docs

**Files:**
- Create: `docs/planning.md`
- Modify: `docs/load-model.md`, `docs/interface.md`, `README.md`, `docs/plan.md`

- [ ] **Step 1: Write them, as the spec's Docs section lists**

- `docs/planning.md` follows `load-model.md`'s shape: the input, the scenario, the
  arithmetic (the same `computeLoadSeries`), the even-spread assumption, the usual reading
  low, and "What the tests pin down" listing Task 2–4's tests in one line each.
- `interface.md` gains the Planning row in the screens table, and one bullet under Charts:
  "A projection is drawn in the pale step of its series, continuous with the history."
- `plan.md` marks project 2 built, with today's date.

- [ ] **Step 2: Check the links**

Run: `grep -n "planning.md" docs/*.md README.md`
Expected: every link points to a file that exists.

- [ ] **Step 3: Commit**

```bash
git add docs README.md
git commit -m "Document the Planning screen and the projection"
```
