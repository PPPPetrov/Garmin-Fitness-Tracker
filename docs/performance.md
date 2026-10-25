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

## Critical power

The two-parameter model: the work done at each duration lies on a straight line,

```
work(t) = CP × t + W′          (work = mean watts × t)
```

**CP** is the slope, in watts: the power that could in principle be held indefinitely, and in
practice close to an hour's best. **W′** is the intercept, in joules: the fixed store of work
the rider can spend above CP before it runs out.

**The window.** At the end of each month the model is fitted to the best power at 2, 5, 10 and
20 minutes from the 90 days before it — the month's last day back to 89 days earlier. For the
month in progress the window ends today. A best is the highest across every ride in the window;
on a tie the earlier ride holds it.

**Which rides.** Only rides whose FIT file is `parsed`. A ride the Garmin cross-check sent back
to `pending` is out, exactly as it is out of the power records.

**The fit.** Ordinary least squares of work on time over the durations present. At least three
of the four are needed. A fit with CP or W′ at zero or below is refused: it means the bests do
not fall away the way a maximal curve does, and is shown as a gap, never as a number.

**Beside Garmin's FTP.** Each month carries Garmin's own FTP as it stood on the window's last
day, from `ftp_at_ride`. The two are drawn together, ours as the main line and Garmin's in grey.
They agree closely when the window holds hard efforts: 228 W against 237 W in October 2026.

**What it cannot see.** The model only knows the efforts actually ridden. With no hard five-
and twenty-minute effort in the window it reads low. That is why November 2023, a window of
easy trainer rides, shows 110 W. There were no powered rides from 2024 to September 2025, so
the series has a gap there.

### What the critical power tests pin down

- Bests built on a known CP and W′ give both back exactly.
- Two durations are not enough, and give no fit.
- A fit with no positive W′ is refused.
- A ride 89 days before the window's end is in it; one 90 days before is not.
- Garmin's FTP is the figure in force on or before the window's end, and absent before the
  first one.
- A month whose window holds too little is a gap, and the series still runs to today.
- The ride count is of distinct rides, not of durations.
- On a tie the earlier ride holds the best.
- No efforts gives an empty series, not an error.

## Ramp rate

How fast fitness is moving: today's fitness minus fitness seven days earlier, in Garmin load
points per week. Fitness is the load model's 42-day average; see
[`load-model.md`](load-model.md#the-formula).

```
ramp(d) = fitness(d) − fitness(d − 7)
```

A day is measured only when both `d` and `d − 7` are past the warm-up window. "Today" is the
latest day the model holds, which is the last sync and not necessarily today's date; the screen
names that day.

**Placed against the rider's own weeks.** The usual ramp limits — five to eight a week — are
written in TSS, a different scale from Garmin's load points, so they would be wrong here by an
unknown factor. Ramp rate is read the way form is, as a rank in this rider's own distribution:

- **percentile**: the share of measured days with a lower ramp, floored, so it never claims
  every day.
- **percentAbove**: the share with a higher ramp, floored. It reads a fall: "a steeper fall than
  94% of your weeks".
- **band**: the fifth of the distribution, from `lowest` to `highest`.
- **lastInBand**: the last day before the current spell that was in the same fifth. The current
  spell is skipped first, or the answer would always be yesterday.
- **estimated**: copied from that day's `is_estimated`, so a week resting on an untrusted ride
  is marked as less sure.

The ranking arithmetic is shared with form in [`src/calc/rank.ts`](../src/calc/rank.ts).

### What the ramp tests pin down

- The ramp is the seven-day difference in fitness.
- A day whose week-earlier day is in the warm-up is not measured.
- The percentile is floored, and the share above is reported beside it.
- The last day in the same fifth skips the current spell.
- The estimated flag is the latest day's own.
- A history no longer than the warm-up plus a week has no ramp, rather than a wrong one.
