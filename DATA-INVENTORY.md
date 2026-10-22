# Garmin Personal API — verified data inventory

Probed: 22 October 2026, against Peter's live account.
Everything below was observed from real responses, not from documentation.

## Connection

| Item | Verified value |
| --- | --- |
| Base URL | `https://personal.connectapi.garmin.com` |
| Token endpoint | `POST /personalapitoken-service/personal-api/personal-api-key/token` |
| Token request auth | header `Authorization: ApiKey <key>`, no body |
| Token response | **raw JWT as `text/plain`, not JSON** — do not `JSON.parse` it |
| Token lifetime | `exp - iat` = exactly 86400 s (24 h) |
| Refresh | none; re-exchange the key |
| Call auth | header `Authorization: Bearer <jwt>` |
| Granted scopes | `CONNECT_READ`, `PERSONAL_API_FITNESS_READ`, `PERSONAL_API_NUTRITION_READ`, `PERSONAL_API_USER_READ`, `PERSONAL_API_WELLNESS_READ` |
| Account timezone | **`Europe/Athens`** (from profile settings and every activity) |
| Rate limiting | **100 requests per rolling window.** See below. |

Reference implementation: [garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python)
(Apache-2.0) — its `client.py` is the authoritative endpoint list.

### Four gotchas that cost real time

1. **Rate limit: 100 requests per rolling window, undocumented.** Request 101 returns
   **HTTP 429** with a body that says exactly how long to wait:

       {"count":101,"limit":100,"retryInSeconds":33,"rateLimitMetaData":1}

   There is no `Retry-After` header and no warning as the limit approaches — the first
   sign is the 429. Honour `retryInSeconds` and retry; a full 423-activity backfill needs
   about five of these pauses.

2. **`limit` on activity search caps at 62.** `limit=62` → 200. `limit=64` and above → **HTTP 500**
   with an empty body, not a 400. Use `limit=50`.

3. **Activity file download needs an exact Accept header.**
   `Accept: application/zip, application/x-zip-compressed, application/octet-stream` → 200.
   Dropping `application/x-zip-compressed` → **HTTP 406 NotAcceptableException**.

4. **The downloaded ZIP is streamed, so its local file header is a lie.** General-purpose
   bit 3 is set and `compressedSize` in the local header reads **0**; the real size is only
   in the central directory. Reading the local header alone yields an empty slice and
   inflate fails with "unexpected end of file" on every file. Read the EOCD record, follow
   it to the central directory, and take the size and local offset from there.

5. Windows `curl` fails this host with `schannel: SEC_E_UNSUPPORTED_FUNCTION`. Node's `fetch` works.

## What the account actually contains

### Activities — rich, and far deeper than expected

| Item | Verified value |
| --- | --- |
| Total activities | **423** |
| Oldest | **2022-10-12** (4 years of history, all retrievable) |
| Per year | 2022: 6 · 2023: 72 · 2024: 91 · 2025: 107 · 2026: 147 |
| Full backfill cost | 423 ÷ 50 = **9 requests** |

Activity types:

| Type | Count | Share | Power meter |
| --- | --- | --- | --- |
| `mountain_biking` | 245 | 58 % | **no** |
| `road_biking` | 112 | 26 % | yes |
| `indoor_cycling` | 61 | 14 % | yes |
| `virtual_ride` | 5 | 1 % | yes |

**Power is present on 135 of 423 rides — 32 %.**

### The consequence: two different load metrics, with very different coverage

`GET /activity-service/activity/{id}` → `summaryDTO`:

| Field | Road ride (power) | MTB ride (no power) |
| --- | --- | --- |
| `averagePower`, `normalizedPower`, `maxPower` | 128 / 163 / 625 | *absent* |
| `functionalThresholdPower` | **237** | *absent* |
| `intensityFactor` | 0.689 | *absent* |
| `trainingStressScore` | 246.9 | *absent* |
| `maxPowerTwentyMinutes` | 190.043 | *absent* |
| `activityTrainingLoad` | 239.189 | **119.602** |
| `trainingEffect` / `anaerobicTrainingEffect` | 4.4 / 2.2 | 3.3 / 1.1 |
| `averageHR` / `maxHR` | 137 / 179 | 132 / 165 |

`trainingStressScore` exists on 31 % of rides. `activityTrainingLoad` exists on 90 % of them,
because it is derived from heart rate and EPOC rather than power.

Any continuous fitness curve must therefore be built on `activityTrainingLoad`.
A curve built on TSS would read Peter's main riding — mountain biking — as rest.

### The trap: a ride without a heart-rate strap gets a load that is wrong, not missing

`activityTrainingLoad` is EPOC-derived, so it needs heart rate. Without the strap Garmin
still returns a number, and that number is about **eight times too low**:

| | rides | mean load per hour |
| --- | --- | --- |
| With heart rate | 401 | **67** |
| Without heart rate | 18 | **8** |

The clearest case, two road rides a fortnight apart:

| | 8 Oct 2026 | 19 Oct 2026 |
| --- | --- | --- |
| Duration | 1 h 22 | 1 h 28 |
| Normalized power | 177 W | 187 W |
| TSS | 77 | **91** |
| Heart rate | 136 bpm | **none recorded** |
| `activityTrainingLoad` | 105 | **22** |

By power the 19 Oct ride was the harder of the two. By training load it barely happened.

A `NULL` announces itself and can be flagged. A plausible-looking wrong number cannot, and
it silently drags the curve down for the next 42 days. **53 of 423 rides (13 %) have a load
that is either missing or recorded without a strap**, and the tracker marks both.

### FTP needs no separate history table

Each powered activity carries `summaryDTO.functionalThresholdPower`: the FTP that was in effect
on that ride's date. Garmin already keeps the dated history; we only have to read it.

### Garmin's TSS formula, confirmed

    TSS = (seconds_with_power x NP x IF) / (FTP x 3600) x 100

Checked against the 138 km ride: 18752 s of power data, NP 163, IF 0.689, FTP 237
→ 246.8, against Garmin's reported 246.9. The denominator is **seconds of recorded power**,
not elapsed, moving or timer duration.

### Original files — full 1 Hz time series

`GET /download-service/files/activity/{id}` returns a ZIP containing `{id}_ACTIVITY.fit`.

| Item | Verified value |
| --- | --- |
| Sample | 138 km / 5 h 20 ride |
| ZIP / FIT size | 447 KB / 793 KB |
| Records | 18 820 at **1 s** intervals |
| Power / HR / cadence coverage | 99.6 % / 99.9 % / 85 % |
| Record fields | `power`, `heartRate`, `cadence`, `speed`, `distance`, `altitude`, `enhancedAltitude`, `enhancedSpeed`, `positionLat/Long`, `temperature`, `leftRightBalance`, `leftTorqueEffectiveness`, `rightTorqueEffectiveness`, `combinedPedalSmoothness`, `accumulatedPower`, `fractionalCadence` |
| Parser | `@garmin/fitsdk` — integrity check passed, 0 errors |

Derived power curve from that file:

| 5 s | 30 s | 1 min | 5 min | 20 min | 60 min |
| --- | --- | --- | --- | --- | --- |
| 563 W | 404 W | 366 W | 215 W | **190 W** | 149 W |

The 20 min figure matches `summaryDTO.maxPowerTwentyMinutes` (190.043) — the FIT parse is correct.

**The summary gives only the 20-minute peak.** Every other duration requires the FIT file.
Full history at ~793 KB per ride ≈ **335 MB**.

## What the account does NOT contain

Peter rides an Edge 530 and owns no wearable. The wellness endpoints all respond, but with
no values. This was checked, not assumed:

| Endpoint | Result |
| --- | --- |
| `/usersummary-service/v2/dailysummaries` | **`includesWellnessData: false` on every day.** `movement`, `heartRate`, `bodyBattery` are all `{}` |
| `/sleep-service/sleep/dailySleep` | object returned, `sleepTimeSeconds` **null** on all 7 dates sampled (Jun–Oct) |
| `/sleep-service/sleep/dailySleepSummariesByDate` | HTTP 400 |
| `/hrv-service/hrv/{date}` | **204, empty** |
| `/wellness-service/wellness/bodyBattery/...` | rows returned, `charged`/`drained` **null** |
| `/usersummary-service/stats/stress/daily/...` | empty array |
| `/usersummary-service/stats/steps/daily/...` | rows exist but reflect ride days only |

Also note: **days without a ride are absent from `dailysummaries` entirely.** It is an
activity log, not a calendar, and cannot be used as a date spine.

Sleep, HRV, Body Battery, stress, steps and Training Readiness are therefore **out of scope** —
not "deferred until available". They would require Peter to buy a watch.

VO2 max and fitness age are likewise absent: `/userprofile-service/userprofile/settings` returns
display preferences only (units, formats, timezone), no physiological values.

## Endpoints worth using

| Purpose | Path |
| --- | --- |
| Activity list | `GET /activitylist-service/activities/search/activities?start&limit&startDate&endDate&activityType` |
| Activity detail | `GET /activity-service/activity/{id}` |
| Original FIT | `GET /download-service/files/activity/{id}` |
| HR zones | `GET /biometric-service/heartRateZones/v2` |
| Profile / units / timezone | `GET /userprofile-service/userprofile/settings` |

Everything else Garmin exposes (sleep, HRV, Body Battery, stress, hydration, nutrition,
menstrual cycle, SpO2, weight, fitness age) is either empty for this account or irrelevant.
