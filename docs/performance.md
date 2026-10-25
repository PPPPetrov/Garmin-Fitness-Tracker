# Performance

The load model says how much work has piled up. Its **fitness** is the 42-day average of
Garmin's training load, so it rises with any month of hard riding whether or not the rider got
any stronger. This document covers the three figures on the Performance screen that move only
when the rider does: **efficiency**, **critical power** and **ramp rate**.

The code is [`src/calc/performance.ts`](../src/calc/performance.ts); the tests are
[`src/calc/performance.test.ts`](../src/calc/performance.test.ts). The endpoint is
[`GET /api/performance`](api.md#get-apiperformance).

## Efficiency

Normalized power divided by average heart rate, in watts per beat. More power for the same
heartbeat is the most direct sign of a better aerobic engine that the summary data can give.

**Which rides count.** A ride counts when it is a road ride, it has both normalized power
and average heart rate, and it has at least 30 minutes of moving time:

```
activity_type = 'road_biking'
normalized_power IS NOT NULL AND avg_hr IS NOT NULL
moving_duration_s >= 1800
```

A strapless ride has no average heart rate, so it drops out on its own.

**Why road rides only.** Power and heart rate sit together in two separate stretches of this
history: 34 indoor rides in 2022–23, and 85 road rides from October 2025. Heart rate runs
differently on a trainer (no cooling air, a different position), so one trend across both
would compare a trainer with a mountain road. In practice efficiency covers the last twelve
months.

**Why every road ride, steady or not.** The textbook rule only counts steady rides:
variability index (normalized ÷ average power) at most 1.1 and at least 40 minutes. On this
terrain half the road rides have a variability index above 1.26, so that rule leaves about
twenty rides. Taking the monthly median over every road ride is noisier, but it can see a
trend; the steady-only rule cannot.

**By month.** Each complete month gets the median of its rides. A month with fewer than 3 rides
is left blank rather than drawn from one or two. The month in progress is not in the series;
its median so far is reported separately.

**The headline.** The median of every qualifying ride in the last three complete months,
against the median of the three months before. Each side needs at least 5 rides, or there is
no headline.

**What it cannot see.** Heat raises heart rate for the same power, so a hot month reads lower.
The rise from April–June to July–September 2026 happened through the summer, against that pull.

### What the efficiency tests pin down

- Indoor rides, rides without heart rate and rides under 30 minutes are left out.
- The median is right for odd and even counts.
- A month with 3 rides has a median; a month with 2 is blank.
- Empty months between rides are in the series as blanks.
- The month in progress is not in the series, but is reported on its own.
- The headline compares complete months only, and is absent when either side has fewer than
  5 rides.
- In January the last three complete months are October to December of the year before.
- No rides at all gives an empty series and no headline, not an error.
