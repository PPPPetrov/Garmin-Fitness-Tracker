# The load model

Three numbers come out of this project: **fitness**, **fatigue** and **form**. They are
arithmetic over one Garmin field. This document says exactly what that arithmetic is, what it
can and cannot see, and what the tests hold still.

The code is [`src/calc/load.ts`](../src/calc/load.ts); the tests are
[`src/calc/load.test.ts`](../src/calc/load.test.ts).

## The input: why training load and not TSS

Garmin reports two measures of how hard a ride was.

**`trainingStressScore`** is derived from power. It is the better number, and it is present on
only about a third of this history: 132 of 423 rides. Mountain biking — 245 rides, 58% of
everything — has no power meter at all.

**`activityTrainingLoad`** is derived from EPOC, which Garmin estimates from heart rate (and
from power when it is there). It is present on the whole history.

A curve built on TSS would read the biggest days of the year — long days in the hills, on the
mountain bike — as rest. So the model is built on `activityTrainingLoad`, and the power data
is used for what it is genuinely good at: the all-time power curve.

## The formula

Fitness and fatigue are exponentially weighted moving averages of each day's total training
load, over 42 and 7 days:

```
fitness(d) = fitness(d−1) + (load(d) − fitness(d−1)) / 42
fatigue(d) = fatigue(d−1) + (load(d) − fatigue(d−1)) / 7
form(d)    = fitness(d−1) − fatigue(d−1)
```

Both series start at zero on the first day of the history.

**Form is lagged a day on purpose.** It is meant to answer "what am I carrying into today",
which is yesterday's state, before today's ride is in it.

**Every calendar day gets a row**, including rest days. A rest day is a zero, not a gap: it is
what makes both curves decay. Through a rest, fatigue falls roughly six times faster than
fitness, which is the whole point of the pair.

**Several rides on one day are summed** before the day enters the series.

Under a steady daily load both curves converge on it, with fatigue arriving first. That
property is a test, not an assumption.

`FORMULA_VERSION` (`ewma-atl7-ctl42-v1`) is stored on every row, so rows computed by an older
version can be told apart. Change the maths, bump the version, and run
`npx tsx src/cli.ts recompute`.

## Precision

The series keeps full precision from day to day and rounds only the value it stores. Rounding
each day before feeding it to the next accumulates: it turns a form of −35.71 into −35.72. One
test exists purely to pin this down, because it is the kind of change that looks like nothing
in a diff.

## The warm-up window

The first 42 days of any history — one fitness time constant — are flagged `is_warmup = 1`.
Starting both curves at zero means the early values say more about where the arithmetic began
than about the rider. The days are kept and shown; they are flagged rather than hidden.

## Rides the model cannot trust

This is the part of the project that matters most, and the part a chart would otherwise hide.

Two kinds of ride carry a load that is wrong:

**1. Garmin gave no load at all.** `activityTrainingLoad` is `NULL`. Easy to spot — 42 rides
here, nearly all of them indoor or virtual.

**2. The ride was recorded without a heart-rate strap.** Garmin still reports a load, and it
is about eight times too low, because the figure is EPOC-derived and EPOC needs heart rate.
Across this history, rides with heart rate average 67 load points per hour and rides without
average 8. One concrete case: the road ride of 19 October 2026 scored TSS 91 — harder, by
power, than the 8 October ride's 77 — and was given a training load of 22 against that ride's
105, purely because the strap was off.

A `NULL` announces itself. A plausible-looking wrong number does not, which is why the second
case is the dangerous one. The rule is one SQL fragment, `UNRELIABLE_LOAD_SQL`, used
everywhere that counts these rides:

```sql
(activity_training_load IS NULL
 OR (avg_hr IS NULL AND COALESCE(duration_s, 0) > 600))
```

The ten-minute floor keeps a short strapless spin from being flagged, where the error is too
small to matter.

### How they are surfaced

- `daily_load.unmeasured_rides` counts such rides **on that day**.
- `daily_load.is_estimated` is 1 when **any** day in the preceding 42 days had one, because
  those days feed the same 42-day window. In this history that marks 640 of 1,472 days.
- The dashboard draws an unmeasured day as an **open hatched column** in the 90-day strip
  rather than a solid one, states the count under the chart and in the title sentence, and
  breaks it down by ride type on the Trends screen.
- The Activities table puts the reason — "no training load" or "no heart-rate strap" — under
  the ride's name.

None of this corrects the number. The work happened and the model cannot see it; the honest
thing is to say so where the number is read, not to interpolate something plausible.

## What the model is not

- **Not a recovery measurement.** It describes training you have already done. Garmin's own
  load figure is itself an estimate.
- **Not comparable to another rider's**, or to a TSS-based curve. The units are Garmin
  training-load points.
- **Not meaningful in its first 42 days**, which is why they are flagged.

## What the tests pin down

[`src/calc/load.test.ts`](../src/calc/load.test.ts):

- every calendar day gets a row, so a rest day is a zero rather than a gap;
- fitness and fatigue move by `load/42` and `load/7`;
- form lags a day;
- both decay towards zero through a rest, and converge on a steady load with fatigue
  arriving first;
- the warm-up and estimated flags cover exactly 42 days;
- overlapping unmeasured rides leave no clear day between them;
- the series keeps full precision between days and rounds only what it stores.

A database test covers the classification itself: a ride with no load, a ride with a load but
no heart-rate strap, and a short strapless ride that should **not** be flagged.
