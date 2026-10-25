# Garmin Fitness Tracker — working plan

Updated: 22 October 2026
Status: API access proven, data inventoried. Ready to build.

Supersedes the original planning draft, kept as [`plan-original-draft.md`](plan-original-draft.md).
Every factual claim here is backed by [`data-inventory.md`](data-inventory.md), which records live responses
from Peter's account rather than documentation.

## Purpose

Help Peter see whether his cycling fitness is improving, and how hard he has been training
lately, from the four years of rides already sitting in his Garmin account.

## What the data forced us to change

The original draft was written the day Garmin's Personal API launched and had to hedge.
Probing the live account settled five questions, and three of them change the design.

**1. There is no wellness data, and there will be none without new hardware.**
Peter rides an Edge 530 and owns no watch. Sleep, HRV, Body Battery, stress, steps, resting
heart rate and Training Readiness all return empty. These are cut from scope — not deferred
"until available". The manual recovery journal is cut too: it was the fallback for this gap,
and a daily form only Peter can fill tends to be abandoned inside a month.

**2. Power covers only a third of the riding, and the missing two thirds are the main sport.**
135 of 423 rides have a power meter. Mountain biking — 245 rides, 58 % of everything — has none.
So `trainingStressScore` is absent from most of the history, while `activityTrainingLoad`
(heart-rate and EPOC derived) is present on all of it.

> **A fitness curve built on TSS would read Peter's biggest riding days as rest.**
> `activityTrainingLoad` is the primary load series. TSS is a secondary, road-and-indoor view,
> always labelled as covering part of the history.

**3. There are four years of history, not ninety days.**
423 activities back to 12 October 2022, retrievable in **nine requests**. The original
90-day-then-maybe-more plan would have discarded the only data long enough to show a multi-year
trend, in exchange for saving about eight HTTP calls. Backfill everything on the first run.

Two smaller corrections:

**4. FTP needs no history table.** Every powered activity already carries
`summaryDTO.functionalThresholdPower` — the FTP in effect on that date. The draft proposed
building a dated FTP table that Garmin already maintains.

**5. The timezone is `Europe/Athens`,** read from the account, not `Europe/Kyiv` as assumed.
It comes from the profile and from each activity rather than from configuration.

## What the draft got right, and is kept

Verify before trusting; show missing data as missing rather than as zero; keep Garmin's own
estimates visually distinct from our calculations; never apply today's FTP to an old ride;
keep the Garmin client separate from storage, calculations and the interface; and defer the
single combined "readiness score". All carried forward.

One thing the draft under-committed on. It treated a calculated load model as optional
("*if* we add a calculated load model"). But that model is the only thing that answers the
question the app exists to answer. It is a first-class feature below, with its formula written
down before it is displayed.

## First version

A private web app on Peter's machine. One Node process serves a JSON API and a React UI,
with SQLite underneath.

| View | What it shows |
| --- | --- |
| Overview | Fitness / fatigue / form today, weekly hours, rides, distance, elevation, last sync |
| Trends | Load curve over 4 years, weekly volume, power curve across selectable windows, FTP over time |
| Activities | Searchable, filterable ride list with per-ride detail |
| Settings | Connection status, sync controls, units, coverage dates, export, delete |

Missing values render as "not recorded", with the reason where we know it — a mountain-bike
ride has no power because there is no power meter, and that is worth saying once rather than
leaving a blank cell.

## The load model, written down before it is built

Exponentially weighted averages of daily `activityTrainingLoad`, the standard impulse-response
form:

```
load(d)    = sum of activityTrainingLoad for all activities on day d, 0 on rest days
fitness(d) = fitness(d-1) + (load(d) - fitness(d-1)) / 42
fatigue(d) = fatigue(d-1) + (load(d) - fatigue(d-1)) / 7
form(d)    = fitness(d-1) - fatigue(d-1)
```

- **Seeded** from the first 42 days of history, shown as a warm-up period and not presented
  as meaningful.
- **Rest days are real zeros.** A day with no ride is a genuine zero input. A day we failed to
  sync is not — it is a gap, marked as such, and the curve is broken rather than interpolated.
- **Units are Garmin training-load points**, not TSS, and the axis says so.
- **Not a recovery measurement.** It estimates training stress from heart rate and power.
  Labelled that way everywhere it appears.
- **A ride without a heart-rate strap is treated as unmeasured.** `activityTrainingLoad` is
  EPOC-derived, so with no strap Garmin returns a number that is roughly eight times too low
  rather than no number at all — the 19 Oct 2026 road ride scored TSS 91, harder by power than
  the 8 Oct ride's 77, yet was given a load of 22 against that ride's 105. Those rides are
  counted alongside the ones with no value, and every day within 42 of one is marked, because
  the whole window it feeds is understated. 53 of 423 rides fall in this group.

Daily grouping uses the activity's local date in `Europe/Athens`.

## Build milestones

### 1. Prove access and inventory the data — done

Token exchange, endpoint surface, history reach, field coverage, FIT contents and two
undocumented gotchas are recorded in [`data-inventory.md`](data-inventory.md). The API key is in `.env`, git-ignored.

### 2. Storage and a complete backfill

- Schema: `activity` (normalized), `activity_raw` (original JSON, verbatim), `power_curve`,
  `fit_file`, `sync_run`.
- Import all 423 activities, oldest first, `limit=50`.
- Download and parse FIT files for the 135 powered rides (~107 MB); store the derived power
  curve, and discard nothing that cannot be re-fetched.
- Garmin activity IDs are the primary key, so re-running the import updates rather than
  duplicates. Re-check a 30-day trailing window each sync for edited rides.
- Record every sync in `sync_run` with counts, failures and coverage dates.

Done when: a second full import changes no row count, and an interrupted import resumes.

### 3. The dashboard

- Overview, Trends and Activities on the real imported data.
- Load curve, weekly volume, power curve, FTP history.
- Usable on a phone screen as well as a desktop.
- Garmin's own numbers and ours visually distinguished wherever both appear.

Done when: Peter opens the app, syncs, and can see whether this month is harder than last.

### 4. Sharpen from use

Reviewed 22 October 2026 against Garmin's
[Swagger docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) — the
**declared** surface, 22 endpoints — and against the local database, which turns out to hold
more than the importer reads. [`data-inventory.md`](data-inventory.md) remains the **measured**
surface; where the two disagree, the measurement wins.

The backlog is ordered by what the evidence supports, not by appeal. Three classes, and the
first is the only one that is certain.

#### A. Already in the database. No request, no key, no new dependency

The importer promotes 34 columns out of `activity_raw.list_json`; the rest of the response is
stored verbatim and never read.

**A1 — Heart-rate time in zone. Built 22 October 2026.** `hrTimeInZone_1` … `_5` were populated
on **264 of 423 rides** and never read. The coverage is recent rather than historical:

| Year | 2024 | 2025 | 2026 |
| --- | --- | --- | --- |
| Rides with all five buckets | 19 | 103 | **142 of 147** |

| Type | mountain_biking | road_biking | indoor_cycling | virtual_ride |
| --- | --- | --- | --- | --- |
| Rides with zones | 158 | 98 | 5 | 3 |

It covers the mountain biking — the 58 % of the riding with no power meter, invisible to every
power-derived figure in the project. The load model says how much; zones say what kind, which is
the question it cannot answer. On a stretch where form climbed and fitness fell, zones separate
*stopped riding* from *rode easy*.

*Built as* a five-row share table on Trends over the selected period, with the span of equal
length before it for comparison. One row per zone rather than the stacked weekly bar sketched
here first: `.share-row` draws a single fill, so a stack would have meant a new component, and
the period control already supplies the time dimension. The columns were filled by
`npx tsx src/cli.ts backfill`, which reads the stored list payloads and touches no network —
the data had been on disk since the first import.

Three limits are stated on screen rather than smoothed over. The buckets cover **0.80 of ride
duration** across the history and about 0.9 recently, because paused and strapless time falls
into none of them, so the figures are shares of recorded time and never of the ride. A ride
carrying a partial set is dropped rather than having its gaps read as zero. And zone coverage
differs between spans, so a period and the one before it are comparable **by share, not by
hours** — the note under the table says so, with both ride counts.

Still open: the bpm boundaries behind the zones. They need
`/biometric-service/heartRateZones/v2` from **B** below, so the rows are labelled "Zone 1" … 
"Zone 5" rather than by heart rate.

**A2 — Garmin's own peak power, as a check on ours. Built 22 October 2026.** The list
response carries `maxAvgPower_{seconds}` far past the five minutes first noted here: 1 s to
300 s on all 135 powered rides, then 600 s and 1200 s on 134, 1800 s on 125 and 3600 s on 104 —
whatever the ride was long enough to hold. Eleven of our thirteen durations have a Garmin
figure beside them; only 15 s and 5400 s do not. FIT is therefore not needed for any duration
up to an hour, but it stays the source, because the point is to check the parser, not to
replace it.

*Built as* [`src/sync/powerCheck.ts`](../src/sync/powerCheck.ts): every stored curve is
compared with Garmin's figures at each shared duration, with a tolerance of 1 % or 2 W,
whichever is larger. A ride that disagrees goes back to `pending` in `fit_file`, with the
worst duration as the reason, and the records leave it out until a FIT sync parses it again.
Overview and Trends say how many rides are held back. It runs after every FIT sync, and on its
own with `npx tsx src/cli.ts verify-power`, which needs no network.

First run, on the curves the old parser stored: **127 of 135 agree, 8 do not**. Three were
known from the five-minute check; the other five disagree only at 10 min to an hour, which
that check could not see. In all eight our figure is the higher one — the signature of A3,
where counting records closes up the pauses inside a window.

**A3 — Sample-rate defect. Fixed 22 October 2026.** [`src/sync/fit.ts`](../src/sync/fit.ts)
inferred the sample rate from the gap between the first two records only and sized every
window in records. Ride `#22736415876` opened with a 26 s pause, so a one-minute window
covered two records; it held the all-time record at 60 s, 120 s, 300 s and 600 s.

The parser now lays the readings on a one-second grid by timestamp (`toSecondStream`). Each
reading stands for one interval of the file's own recording rate — the commonest gap between
records — and a longer gap is zero watts. Holding a reading longer was tried and rejected: it
turns a pause after a hard pedal stroke into seconds of that power, which is the same
inflation in a new place.

With a new API key the same evening, the eight were downloaded again and parsed with the
new code: **all 135 rides now agree with Garmin**. The four records read 424 W, 371 W, 315 W
and 265 W, from 476, 432, 344 and 268.5. The five-minute record rose again once its ride
(`#24046432641`, Garmin's own 315 W) came back in.

Still open, and optional: the other 127 curves were made by the old parser and agree only
because their files happened to have no pauses that mattered. Re-parsing them with the new
code would confirm it on the whole history; their files are not on disk, so it costs 127
downloads once, and nothing after that.

**A4 — Minor, take only if a screen needs them.** Route start and end coordinates (360 rides),
min/max elevation and max vertical speed (362), min/max temperature (381), max speed (420),
lap count (423), respiration rate (369), `maxFtp` (243), `bmrCalories` (381).

#### B. Declared in Swagger, never probed. Needs a working key first

Peter's key currently returns 401, so none of these could be tested on 22 October 2026. Each is
a probe before it is a feature.

| Endpoint | Why it might matter |
| --- | --- |
| `/biometric-service/heartRateZones/v2` | The bpm boundaries that would label A1's zones. [`client.ts`](../src/garmin/client.ts) already has `fetchHeartRateZones()` and **nothing calls it**. |
| `/wellnessactivity-service/activity/summary/range/{from}/{untilDate}` | Carries `TimeInZoneDTO`, and is a **range** query — one request where the activity detail needs 423. May supersede A1 or merely duplicate it. |
| `/fitnessage-service/fitnessage/v2/{calendarDate}` | The inventory rules out VO2 max and fitness age, but on the evidence of `/userprofile-service/settings`, which only ever returns display preferences. This endpoint was never tried, so that dismissal is **unproven**. |
| `/weight-service/weight/range/{startDate}/{endDate}` | Dismissed as irrelevant. With power on 135 rides it is W/kg, which is the figure riders actually compare. |
| `/activity-service/activity/{activityId}/workouts` | Never probed. Structured workouts attached to a ride. |
| `/usersummary-service/usersummary/daily`, `/hrv-service/hrv/daily/{fromDate}/{toDate}` | Only the `v2` and single-date variants were probed. The other shape was not. |

#### C. Closed, with the measurement that closed it

Not deferred — ruled out, so nobody reopens them on the strength of the Swagger listing.

| Candidate | Measurement |
| --- | --- |
| Sleep, HRV, Body Battery, stress, steps, hydration, nutrition | Endpoints respond, values empty. No wearable. |
| Per-ride splits and laps | `splitSummaries` non-empty on **6 of 423** rides. |
| Garmin's own PR flag | `isPR` true on **4 of 423** rides. |
| Excluding rides from the power curve | `excludeFromPowerCurveReports` true on **0** rides. |

#### Three projects, 25 October 2026

Picked after looking at what intervals.icu, TrainingPeaks, Strava and VeloViewer offer, against
what this data can support. Each has its own spec and plan under [`superpowers/`](superpowers/).

1. **Performance. Built 25 October 2026.** Efficiency on road rides, critical power beside
   Garmin's FTP, and ramp rate against the rider's own weeks, on a fourth screen. Trends now
   covers load only. See [`performance.md`](performance.md).
2. **Planning ahead. Built 25 October 2026.** Form and fitness projected forward to a chosen
   date under a share of the rider's usual load, on a fifth screen. See
   [`planning.md`](planning.md).
3. **Motivation.** Records and yearly bests, the Eddington number (64 km today), a year in
   review, goals.

Heatmaps and explorer tiles were set aside: they need GPS tracks, which means a FIT download for
every ride.

#### Still unplanned, still candidates

Export, backup, restore, delete. Always-on hosting, phone access, route and segment comparison,
goals.

## Technical direction

TypeScript throughout. **Hono** for the API, **better-sqlite3** for storage, **Vite + React**
for the UI, **@garmin/fitsdk** for FIT parsing — the official parser, which read the sample
file with zero errors. One process, one database file, no build-time complexity.

```
Garmin Personal API -> importer -> SQLite -> calculations -> JSON API -> React
```

Each calculated metric is stored with its formula version and the data coverage it was built
from, so a number on screen can always be traced back to the rides behind it.

## Validation before any milestone is called done

- Compare imported rides and weekly totals against Garmin Connect, watching the three different
  durations (`duration`, `movingDuration`, `elapsedDuration` — they differ by an hour on the
  138 km ride).
- Re-run an import, interrupt one, edit a ride in Connect, and let a token expire.
- Check the DST boundaries in `Europe/Athens` and the 2022 history edge.
- Verify the power curve against Garmin's `maxAvgPower_*` figures, eleven durations per ride:
  `npx tsx src/cli.ts verify-power`.
- Confirm the key and tokens never reach the browser bundle or any log.

## Out of scope

Sleep, HRV, Body Battery, stress, steps, Training Readiness, recovery journal — no data source.
Multi-user, social, live streaming, workout push to the Edge, AI coaching, and a single combined
fitness score.

## Sources

- [Personal API overview](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [Swagger docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) — the declared endpoint surface and its schemas
- [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) — authoritative endpoint list
- [`data-inventory.md`](data-inventory.md) — what this account actually returns
