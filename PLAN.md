# Garmin Fitness Tracker — working plan

Updated: 22 October 2026
Status: API access proven, data inventoried. Ready to build.

Supersedes the original planning draft, kept as `PLAN-original-chatgpt.md`.
Every factual claim here is backed by `DATA-INVENTORY.md`, which records live responses
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
undocumented gotchas are recorded in `DATA-INVENTORY.md`. The API key is in `.env`, git-ignored.

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

- Review together after real use, then pick a short backlog.
- Export, backup, restore, delete.
- Candidates, not commitments: always-on hosting, phone access, route and segment comparison,
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
- Verify the power curve against `maxPowerTwentyMinutes`, the one duration Garmin gives us to
  check against.
- Confirm the key and tokens never reach the browser bundle or any log.

## Out of scope

Sleep, HRV, Body Battery, stress, steps, Training Readiness, recovery journal — no data source.
Multi-user, social, live streaming, workout push to the Edge, AI coaching, and a single combined
fitness score.

## Sources

- [Personal API overview](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) — authoritative endpoint list
- `DATA-INVENTORY.md` — what this account actually returns
