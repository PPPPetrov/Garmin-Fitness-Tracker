# Planning ahead — design

Date: 25 October 2026
Status: agreed in conversation, awaiting review of this document
Branch: `claude/planning-ahead`

## Why

The load model says where the rider is today. It cannot answer the question that comes
before an event, a rest week or a taper: if I ride like this from now on, where will I be on
the day? The arithmetic to answer it already exists. Fitness and fatigue are moving averages
of daily load, so feeding them an assumed load gives a projection, with no new maths.

This is the second of three projects agreed on 25 October 2026:

1. **Performance**: efficiency, critical power, ramp rate. Built.
2. **Planning ahead** (this document): form projected forward to a chosen date.
3. **Motivation**: records and yearly bests, Eddington number, year in review, goals.

The rider wants to plan towards three things: a **specific event** on a date, a **rest week**,
and a **taper** before something. One two-phase scenario covers all three.

Unchanged from [`plan.md`](../../plan.md): local only, no wellness data, nothing that tells
the rider what to ride, missing data shown as missing. A projection is arithmetic on the
existing load model. It is labelled as such everywhere it appears, and it never suggests a
scenario.

## What the data allows, measured 25 October 2026

- **Starting state.** The last complete day is 24 October: fitness 76.00, fatigue 58.88.
  Form carried into today is +17.12, already in the top fifth of the rider's history.
- **The usual load.** The 28 complete days to 24 October hold 1,833 load points from 14
  rides. That is 65.5 a day, or 458 a week.
- **The usual load reads low.** 5 of those 14 rides have no usable load
  (`UNRELIABLE_LOAD_SQL`: no load, or no heart-rate strap). 100% of the usual is therefore
  less than what the rider actually rides. The screen says so and does not correct it.
- **Less sure.** The last unmeasured ride was on 23 October, so every day up to 3 December
  rests on a 42-day window with a hole in it.
- **Rest moves form fast.** Resting from today, form peaks at +47.66 on 6 November, while
  fitness falls from 76.0 to 56.9 by then. Fatigue falls about six times faster than fitness,
  which is the whole effect a taper relies on.

## The calculation

New file `src/calc/planning.ts`. The calculations are pure functions over plain rows, tested
on their own, with a thin wrapper that reads the database, following `formPosition` /
`currentFormPosition` in `form.ts`. The projection is never stored, and it never touches
`daily_load`.

### The starting point

The projection starts from **yesterday**, the last complete day. **Today is the first
projected day.** A ride already synced today is history and stays in the series as measured.
A ride done today but not yet synced is invisible to the projection, as it is to every other
screen.

### The usual load

`usual.perDay` is the sum of `load_points` over the 28 complete days ending yesterday,
divided by 28. Alongside it the response carries the ride count in those days, how many of
them match `UNRELIABLE_LOAD_SQL`, and the window's first and last date. `perWeek` is
`perDay × 7`.

A history shorter than 28 days uses what it has, divides by the days actually present, and
reports that span. With no history at all there is no projection.

### The scenario

| Field | Meaning |
| --- | --- |
| `eventDate` | The day being planned towards. From tomorrow to 180 days ahead. |
| `switchDate` | The day the second phase starts. From today to `eventDate`, inclusive. |
| `beforePct` | Share of the usual load from today until the day before `switchDate`. |
| `afterPct` | Share of the usual load from `switchDate` until the day before `eventDate`. |
| `name` | What the event is called, up to 60 characters. Optional. |

Both percentages are one of 0, 25, 50, 75, 100, 125 or 150.

The three cases the rider plans for:
- **Rest from today:** `switchDate` = today, `afterPct` = 0.
- **Taper:** `beforePct` = 100, `switchDate` ten days before the event, `afterPct` = 50.
- **Rest week, then back:** `beforePct` = 0, `switchDate` seven days out, `afterPct` = 100.

**Load is spread evenly across the days of each phase.** Real riding is lumpy, and form on
the day of an event depends mostly on the last two or three days. A big ride the day before
brings form down further than the projection shows. This is a deliberate simplification,
stated behind the ⓘ on the scenario card.

**The event day's own load is not part of the projection.** Form on the event day is, by
the model's definition, what the rider carries into it: `fitness(eve) − fatigue(eve)`.
Fitness on the day is reported as of the same eve, so the two figures describe the same
moment.

### The arithmetic

The projected days are added to the same `perDay` map that `recomputeDailyLoad` builds, with
`unmeasured: 0` and `rides: 0`, and the **same `computeLoadSeries`** runs from the first day
of the history to the event date. The formula exists in one place, so a projection cannot
drift from the history it continues. The historical part of the result must equal
`daily_load` row for row, and a test holds that.

`estimated` on a projected day comes out of `computeLoadSeries` unchanged. A projected day
within 42 days of the last unmeasured ride is less sure, because the window it continues has
a hole in it.

### What is reported

- **The event day:** `form`, `fitness`, and `fitnessChange` against yesterday's fitness.
- **Its place:** `percentile`, `band` and `rank` of the event-day form among all measured
  non-warm-up days, with `flooredPercentile`, `fifthOf` and `countAtOrBelow` from `rank.ts`.
  These are the same figures and the same bands as `formPosition`. Projected days are never
  added to the distribution being ranked against.
- **`turnsPositive`:** the first projected day with form ≥ 0, when form going into today is
  negative. It is null when form is already zero or more, or never turns positive before the
  event.
- **`peak`:** the projected day with the highest form up to and including the event day,
  with that form and the fitness on the same day. On a tie the earliest day wins.
- **`switchDay`:** form and fitness on `switchDate`.

### With no saved plan

The screen still answers something. The default scenario is **rest from today for 28 days**:
`eventDate` = today + 28, `switchDate` = today, `afterPct` = 0. It is never saved unless the
rider saves it.

## Storage

New table in `schema.sql`, created with `CREATE TABLE IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS plan (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT,
  event_date  TEXT NOT NULL,
  switch_date TEXT NOT NULL,
  before_pct  INTEGER NOT NULL,
  after_pct   INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
```

There is one plan at a time. This is the first table holding something the rider typed rather
than something Garmin sent. Sync and `recompute` never read or write it.

## API

### `GET /api/planning`

With no parameters, it projects the saved plan, or the default scenario when there is none.
With `?event=YYYY-MM-DD&switch=YYYY-MM-DD&before=N&after=N`, it projects that scenario
**without saving it**. That is what the controls call while the rider tries things out.
Invalid parameters return 400 with one sentence saying which one and why.

```ts
{
  plan: { name: string | null; eventDate: string; switchDate: string;
          beforePct: number; afterPct: number } | null;   // the saved row, as stored
  scenario: { eventDate: string; switchDate: string;
              beforePct: number; afterPct: number;
              source: 'saved' | 'query' | 'default' };     // what was projected
  past: string | null;            // the saved event's date, when it is before today
  start: { date: string; fitness: number; fatigue: number; form: number };   // yesterday
  usual: { perDay: number; perWeek: number; rides: number; unmeasured: number;
           from: string; to: string };
  series: { date: string; fitness: number; fatigue: number; form: number;
            projected: boolean; estimated: boolean }[];   // 42 days of history, then the projection
  event: { date: string; form: number; fitness: number; fitnessChange: number;
           percentile: number; band: FormBand; rank: number; measuredDays: number };
  turnsPositive: string | null;
  peak: { date: string; form: number; fitness: number };
  switchDay: { date: string; form: number; fitness: number };
  formula: string;                // FORMULA_VERSION
} | null                          // null only when there is no history at all
```

When the saved event is in the past, `plan` still carries it, `past` is its date, and the
default scenario is projected.

### `PUT /api/planning`

Body: `{ name, eventDate, switchDate, beforePct, afterPct }`, checked against the same rules
as the query. It upserts the single row and returns the same body as `GET`. A request whose
`Content-Type` is not `application/json` gets 415. The server listens on localhost only, and
the JSON-only rule keeps a plain cross-site form post from writing to it.

### `DELETE /api/planning`

Removes the row and returns 204.

All three are documented in `docs/api.md`, with typed calls in `web/src/api.ts`.

## The screen

`web/src/views/Planning.tsx`. A fifth menu item, **Planning**, between Performance and
Activities, reached at `#planning`, with its own menu icon.

**Question:** Where will I be on the day that matters?

**The finding under the title** is always conditional, so it reads as arithmetic, not
advice:
- *With a plan:* "If you ride half your usual from 19 Nov, form on 29 Nov is +23.3, fresher
  than 91% of your days, with fitness 63.0, 13.0 under yesterday."
- *Rest, saved or default:* "If you rest from today, form peaks at +47.7 on 6 Nov, and
  fitness falls to 56.9 by then."
- *The saved event has passed:* "Your event on 29 Nov has passed." followed by the
  default-scenario sentence.

The phrasing of the scenario is built from the percentages ("rest" for 0, "half your usual"
for 50, "your usual" for 100, "{n}% of your usual" otherwise) in a small copy module tested
on its own, like `performanceCopy.ts`.

**Layout**, from the existing grid classes:

| Row | Grid | Cards |
| --- | --- | --- |
| 1 | `grid-1-1-1` | Form on the day · Fitness on the day · To go |
| 2 | `grid-2-1` | Projection · Scenario |
| 3 | `grid-1-1` | Along the way · What this rests on |

**Row 1, KPI cards.** Each card title starts with "Projected", so a projected figure is never
read as a measured one.
- **Projected form on the day:** signed, one decimal. Caption: "Fresher than {p}% of your
  days". Below zero: "More tired than {q}% of your days", where q is the floored share of
  days with a higher form.
- **Projected fitness on the day:** one decimal. Caption: the signed change on yesterday.
  The change is **grey either way**. In a hypothetical a fall is neither good nor bad, and
  colouring it would be a judgement on the scenario.
- **To go:** days from today to the event. Caption: "{weekday} {date} · {name}", without
  the name when there is none.
- When the event day is `estimated`, the form and fitness captions end with "· less sure".

**Row 2:**
- **Projection:** a `LineChart`, 300 px tall. Form is in `--chart-1` and fitness in
  `--chart-2`. It shows 42 days of history, then the projection.
  - **Projected segments are drawn in the pale step of their series colour.** This follows
    the rule that a period not yet over is drawn pale. The line is continuous through today,
    so nothing is broken that is not missing.
  - The annotation row above the plot marks **today**, the **switch** (labelled with the
    second phase, e.g. "50%"; no marker when `switchDate` is today) and the **event** (its
    name, or "event").
  - Zero gets the darker line. The tooltip names the day and says "projected" on projected
    days.
- **Scenario:** the controls, top to bottom.
  - *Name:* a text input.
  - *Event date and switch date:* native date inputs, constrained to the valid ranges.
  - *Before and after the switch:* two segmented controls, 0 to 150% in steps of 25. Under
    each is what the choice means in points: "50% = 229 a week".
  - *Save:* an outline button. Sync stays the only filled control. "Not saved" sits beside
    Save whenever the controls differ from the saved plan.
  - *Clear plan:* a text button, only shown when a plan is saved.
  - Changing a control re-projects through `GET` with query parameters, debounced 250 ms. A
    save is a separate action.

**Row 3:**
- **Along the way:** `.rows`.
  - Form turns positive: the date, or "Already positive" / "Not before the event".
  - Peak form: the value and date, with fitness on that day.
  - The switch: form and fitness on `switchDate`, when it is not today.
- **What this rests on:** `.rows`.
  - The start: yesterday's fitness, fatigue and form.
  - The usual: "458 a week, from 14 rides in the 28 days to 24 Oct".
  - When `unmeasured > 0`: "5 of them have no usable load, so the usual reads low".
  - When any projected day is `estimated`: "Less sure until {last estimated day + 1}".
  - The formula version.
- **Height check:** the two cards in this row must end level at 1440 px.

**ⓘ text, behind the info marks:**
- *Projection:* the same arithmetic as the history, fed an assumed load instead of a measured
  one. It says what would happen if the rider rode exactly like this, not what to ride.
- *Scenario:* the load is spread evenly across the days. Real riding is not, and a hard ride
  a day or two before the event leaves form lower than shown. The usual is the rider's own
  last four weeks, not a target.
- *Form on the day:* what is carried into the day, before that day's riding, the same
  definition as on Overview.

**States**, following `docs/interface.md`:
- Loading: skeletons at final size.
- An error loading the page sits in the card that failed. A rejected save sits in the
  Scenario card, as the 400's sentence.
- No history: every card keeps its frame. The finding is "Nothing synced yet, so there is
  nothing to project from."
- Missing values: the grey `DASH`.
- On a phone the rows stack. The segmented controls stay on one line, and the date inputs
  take the full card width.

## Changes elsewhere

- **App:** a new `VIEWS` entry, route and menu icon.
- **Overview, Trends, Performance:** unchanged. There is no countdown on Overview in this
  project.

## Tests

`src/calc/planning.test.ts`, node:test, alongside the existing tests.

**The arithmetic:**
- The historical part of a projection equals `computeLoadSeries` over the history alone,
  row for row.
- Rest from a known state: fitness and fatigue decay by `1/42` and `1/7` a day.
- At 100% of a steady usual load, a projection from a converged state stays flat.
- The event day's form is `fitness(eve) − fatigue(eve)`, and the event day's own load
  changes nothing reported.
- The switch: the day before `switchDate` gets `beforePct`, and `switchDate` gets `afterPct`.
- When `switchDate` is today, the first phase is empty.

**The usual:**
- It covers the 28 days ending yesterday, and today's load is not in it.
- Unmeasured rides in the window are counted.
- A history shorter than 28 days divides by the days present and reports the span.

**What is reported:**
- `turnsPositive` is null when form is already ≥ 0, a date when form crosses, and null when
  it does not cross before the event.
- `peak` takes the earliest of equal days.
- The event-day percentile is floored and ranked against measured days only. Projected days
  are not in the distribution.
- `estimated` carries into projected days for 42 days after the last unmeasured ride, and
  stops after that.

**Validation**, on the wrapper and the routes:
- An event today or more than 180 days out is rejected. So is a switch outside today to the
  event, and a percentage not in the list.
- `PUT` with a form body gets 415.
- `PUT` then `GET` round-trips the plan, and `DELETE` then `GET` falls back to the default.
- A saved event in the past comes back with `past` set and the default scenario projected.

**The copy module:** the scenario phrasing for 0, 50, 100 and 75, and the negative-form
caption.

**Also:**
- `npm test` and `npm run typecheck` pass.
- The screen is checked in the browser at 1440, 900 and 375 px, with rows ending level.
- Save, reload and Clear plan are checked in the real app.

## Docs

- New `docs/planning.md`: the projection in the style of `load-model.md`, including the
  even-spread assumption and what the tests pin down.
- `docs/load-model.md`: a short section pointing to it. The projection reuses
  `computeLoadSeries` and never writes to `daily_load`.
- `docs/api.md`: the three routes.
- `docs/interface.md`: the screens table, the Planning shape, and the pale-projection rule
  under Charts.
- `README.md`: the screens table, and a "Projects form forward" paragraph in What it does.
- `docs/plan.md`: project 2 marked built when it lands.

## Not in this project

- Several events, or A/B/C priorities.
- Day-by-day planned rides, or load entered in points.
- Spreading load by the rider's weekly rhythm instead of evenly.
- Comparing the projection with what actually happened after the event.
- A countdown on Overview.
- Any suggested scenario, target form or "optimal taper". That would be coaching.

## Expected values on 25 October 2026

A sanity check for the finished screen against today's database. It is not a test fixture.

| Figure | Expected |
| --- | --- |
| Start (24 Oct) | fitness 76.00, fatigue 58.88; form into today +17.12 |
| Usual | 65.5 a day, 458 a week, 14 rides, 5 unmeasured, 27 Sep–24 Oct |
| Default (rest to 22 Nov) | event form +37.92, fitness 38.71 (−37.29), 99th percentile, rank 14 of 1,433 |
| Default peak | +47.66 on 6 Nov, fitness 56.92 |
| Taper (event 29 Nov, switch 19 Nov, 100% then 50%) | event form +23.28, fitness 62.99 (−13.01), 91st percentile, rank 121 |
| Taper switch day (19 Nov) | form +5.90, fitness 71.24 |
| `turnsPositive` | null in both: form is already positive |
| Less sure until | 4 Dec |
