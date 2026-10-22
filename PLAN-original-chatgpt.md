# Garmin Fitness Tracker — working plan

Updated: 21 October 2026
Status: planning; implementation has not started.

## Purpose

Build a personal tracker that helps Peter understand changes in overall fitness and recovery, starting with the cycling data he already records.

Confirmed equipment: Garmin Edge 530, power meter, and heart-rate sensor. No sleep-tracking wearable has been confirmed.

The first version should answer:

- How consistently am I training, and how is that changing?
- Is my cycling performance improving over weeks and months?
- How much training have I accumulated recently?
- How do I feel alongside that training history?

Cycling performance is the first measurable part of overall fitness. Other activities and wellbeing context can be added without treating cycling data as a complete measure of health.

## First version

Proposed format: a private, responsive web app, initially running on Peter's computer. Phone access and hosting can follow if useful. Local syncing works while the app or its sync process is running; an always-on deployment would be a separate step.

| View | What it shows |
| --- | --- |
| Overview | Weekly training time, ride count, distance, elevation, recent training load, latest check-in, last successful sync |
| Fitness trends | Comparisons over 4 and 12 weeks; power records for selected durations; FTP and Garmin VO2 max estimates when available |
| Activities | Searchable rides with date, duration, distance, power, heart rate, zones and training effect where recorded |
| Recovery journal | Brief manual entries for perceived fatigue, soreness, sleep quality and notes, displayed alongside training history |
| Settings and data | Garmin connection status, sync controls, units, FTP history, export and deletion controls |

Missing metrics should appear as unavailable, with a reason where possible. A missing ride or failed sync must not silently become a rest day or a zero measurement.

## Garmin connection: verified facts and open questions

Garmin's Personal API is intended for accessing one's own data. It uses a personal API key to obtain an access token. Tokens last up to 24 hours; there is no refresh token, so the app obtains another token with the key when necessary. The Personal program uses pull delivery.

The Swagger reference currently documents:

- Activity search with pagination and local-date filters, activity details, and original activity-file download.
- Activity summary fields for power, heart rate, zone durations, training stress, intensity factor, training effect, peak power durations, VO2 max and FTP-related values.
- Separate health endpoints, including sleep, HRV, daily summaries, Body Battery and weight.

A documented field is not a guarantee that Peter's account or device supplies it. The initial connection milestone must establish actual coverage, historical reach, request limits and file contents.

Recovery time and Garmin Training Readiness are not promised features. An Edge 530 with ride sensors does not provide an overnight wellness history by itself. Sleep, HRV and Body Battery views depend on another data source being available in the account.

## Build milestones

### 1. Prove access and inventory the data

- Have Peter create his Personal API key in Garmin Connect and configure it locally using a protected secret setting. Keep credentials out of chat, browser bundles, logs and source control.
- Implement the documented key-to-token exchange and handle expiry and revocation clearly.
- Import a small recent sample and compare representative rides against Garmin Connect.
- Check which fields contain usable values, whether original FIT files include the needed time-series data, and how far history can be retrieved.
- Record endpoint parameters, units, missing-value conventions and any observed rate limits in a short data inventory.

Done when: real rides can be retrieved reliably and we know which planned metrics are supported. If account access is delayed, use clearly labelled sample data or manual FIT imports to continue the interface, while keeping live integration incomplete.

### 2. Create reliable local storage and sync

- Store original responses plus normalized activity records, optional FIT files, check-ins and dated FTP settings.
- Start with a 90-day historical import if supported, then offer older history in resumable batches.
- Add manual sync and sync on startup; add periodic sync while running after limits are established.
- Use Garmin activity IDs to prevent duplicates. Recheck a recent overlap window for edits and allow a full reconciliation for older changes or deletions.
- Handle pagination, interruptions, expired credentials, throttling and partial failures. Show coverage dates and the last successful sync.
- Preserve UTC timestamps and activity-local dates; use Europe/Kyiv for the default display and configurable daily grouping. Store consistent internal units and convert for display.

Done when: repeating an import changes existing records appropriately without duplicating rides, and interrupted imports can resume.

### 3. Deliver the first useful dashboard

- Build Overview, Activities and Settings using the real imported data.
- Add date filtering, weekly comparisons, clear units and useful empty states.
- Make the layout usable on desktop and narrow screens.
- Label Garmin-provided estimates and the app's own calculations separately.

Done when: Peter can open the app, sync, and understand his recent cycling activity in one place.

### 4. Add fitness and recovery context

- Add power records and longer-term trends, using summary fields first and FIT parsing where needed.
- Show Garmin training stress and activity training load as separate measures; do not combine their scales.
- Add FTP history and use the value effective on each ride's date for any app-calculated power stress. Do not apply today's FTP to all historical rides.
- If we add a calculated load model, document its formula, initialization period, missing-data behavior and limitations before displaying it.
- Add the recovery journal and compare entries with recent training. Label any fatigue or freshness model as a training estimate rather than a direct recovery measurement.
- Add wearable-derived health trends only when suitable data exists.

Done when: trend calculations can be explained, trace back to source rides and remain understandable with incomplete data.

### 5. Improve from actual use

- Review the dashboard with Peter after he has used it and prioritize a short backlog together.
- Add export, local backup and restore, and clear data deletion.
- Consider phone access, always-on hosting, other activities, route comparisons, goals and wearable integrations as separate improvements.
- Maintain this plan and a changelog as features are completed or priorities change.

## Proposed technical direction

Use one TypeScript web application with a server-side Garmin client and a local SQLite database. A Next.js-based app is a candidate, with the final package choices made when implementation starts. This keeps the initial app small while leaving room for a hosted database later.

Data flow: Garmin Connect -> authenticated server-side importer -> local database -> trend calculations -> private dashboard.

Keep the Garmin integration separate from storage, calculations and the interface so changes to the new API do not require rewriting the dashboard. Store each calculated metric with its source, formula version and data coverage where relevant.

## Validation before calling a milestone complete

- Compare several imported rides and aggregate totals with Garmin Connect, accounting for moving, timer and elapsed duration differences.
- Check duplicate imports, a partial import, edited rides and a token-expiry failure.
- Verify date boundaries, daylight-saving changes, unit conversions, missing sensors and no-data periods.
- Test nontrivial calculations with small, independently understandable examples; inspect charts against their underlying records.
- Confirm the API key and tokens never reach the client or application logs, and test backup restoration before relying on backups.

## Deferred from the first version

Multi-user accounts, social feeds, live sensor streaming, workout delivery to the Edge, AI coaching and a single combined fitness/readiness score. The initial focus is trustworthy personal history and trends.

## Sources

- [Garmin Connect program overview](https://developer.garmin.com/gc-developer-program/overview/)
- [Personal API setup](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [Personal API Swagger reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Edge 530 performance measurements](https://www8.garmin.com/manuals-apac/webhelp/edge530/EN-SG/GUID-625D9C69-FE7F-4961-A40B-A3A70EE69DE3-9823.html)
- [Garmin recovery time availability](https://support.garmin.com/en-IE/?faq=8ImmxVkZMh4EYYq5Zp2bR8)

## Next implementation step

Start milestone 1: establish the local application skeleton and safe credential configuration, then validate the Personal API with a small sample of Peter's rides. Do not begin implementation until the planning discussion is finished.
