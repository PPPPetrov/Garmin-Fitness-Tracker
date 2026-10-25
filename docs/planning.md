# Planning ahead

The load model says where fitness, fatigue and form are today. The Planning screen carries them
forward to a date the rider picks, under a load the rider picks, and says where form would sit
on the day. It is the same arithmetic as [`load-model.md`](load-model.md), run past today with
an assumed load in place of a recorded one.

The code is [`src/calc/planning.ts`](../src/calc/planning.ts), with the routes in
[`src/routes/planning.ts`](../src/routes/planning.ts); the tests are
[`src/calc/planning.test.ts`](../src/calc/planning.test.ts) and
[`src/routes/planning.test.ts`](../src/routes/planning.test.ts). The endpoints are
[`/api/planning`](api.md#get-apiplanning).

## The input: a share of the usual load

There are no planned rides and no points to type in. The rider's assumption is a **share of
their own usual load**, so every figure on the screen reads "if you rode this much".

**The usual load** is the average of `activityTrainingLoad` per day over the 28 complete days
ending yesterday. Today is left out because it is not over. A history shorter than 28 days
divides by the days there are. On 25 October 2026 that is 65.5 points a day, 458 a week, over
14 rides, 5 of them unmeasured, from 27 September to 24 October.

**The share** is one of 0, 25, 50, 75, 100, 125 or 150 percent. 0 is rest and 100 is the
usual. The screen shows each step beside its weekly points, so "50%" reads as "229 a week".

## The scenario

A scenario is an event date and two phases:

| Field | Meaning |
| --- | --- |
| `eventDate` | The day being planned towards. After today, and within 180 days of it. |
| `beforePct` | The share ridden on every day before the switch date. |
| `switchDate` | The first day the second share applies. From today to the event date. |
| `afterPct` | The share ridden from the switch date onwards. |

A taper is 100% until a date and 50% from it. A rest is 0% from today. A block is 125% and
then 75%. The code does not know which of these is which, and none is suggested. With nothing
chosen the screen starts from the **default scenario**: rest from today, 28 days ahead. The
same applies when the saved event has already passed: the controls start from the default, and
the screen says the saved date has gone by.

Only one plan can be saved, with an optional name of up to 60 characters. It is kept in the
`plan` table and nothing else is stored: the projection is recomputed on every request and
never written to `daily_load`.

## The arithmetic

The projection builds a day-by-day load from the first day of the history to the event date,
then runs the stored series' own function, `computeLoadSeries`, over it. The 7-day and 42-day
averages, the lagged form and the full precision between days are therefore the same, with no
second copy of the formula to drift.

- Every day before today keeps its recorded load.
- A day from today up to the event takes the assumed load: the share at that date times the
  usual load per day.
- **A day that already has a synced ride keeps its measured load and is not projected.** A
  ride synced this morning counts as ridden, and only the days with nothing recorded take the
  assumed load. Such a day is drawn as history, not as projection.
- **The event day itself is fed nothing.** Its form is the state going into it, as on every
  other day, and the fitness shown for it is yesterday's.

Under rest, fitness falls by 1/42 of itself a day and fatigue by 1/7. Fatigue therefore falls
about six times faster than fitness, which is why form climbs in the first days of a rest and
then flattens, and why the best day is not always the last one.

### What it reports

| Figure | What it is |
| --- | --- |
| `start` | The state carried into today: fitness and fatigue as of yesterday, and form into today. |
| `event` | Form and fitness on the event day, the change in fitness since `start`, and where that form sits among the rider's own measured days (percentile, rank, band), placed as in [`form.ts`](../src/calc/form.ts). |
| `turnsPositive` | The first day form reaches zero, when it starts below zero. Null otherwise. |
| `peak` | The day of highest form from today to the event, the earliest if several tie. Its fitness is the eve's. |
| `switchDay` | Form and fitness on the switch date. |
| `lessSureUntil` | See below. |

The finding at the top of the screen is one sentence. When the scenario's last phase is rest,
it names the **peak**, because under rest the event day is rarely the best one. For any other
scenario it names the form on the **event day**, with where it sits and how fitness compares
with yesterday's. A saved event that has gone by is said first.

## The even-spread assumption

The model feeds the assumed load as the same number every day of a phase. A rider who plans
458 points a week and rides it on Saturday and Sunday will see a different path between the
weekends, because fatigue moves faster than that gap can average out. Over weeks the totals
match; day by day they do not. The projection says nothing about which days to ride, and
spreading load by the rider's weekly rhythm is not attempted.

## Where the projection is less sure

The load model cannot see rides that have no usable training load (see
[Rides the model cannot trust](load-model.md#rides-the-model-cannot-trust)). That blind spot
does not end at today: any day within 42 days of one is `estimated`, and the projection starts
from a state that was.

`lessSureUntil` is the first day the 42-day window is clear of the last unmeasured ride, or
null when no projected day is affected. On 25 October 2026 it is 4 December. It can fall after
the event, and then the event itself is less sure. The chart shades the days it covers and
the screen says how long it lasts.

## The usual reading is low

The usual load is taken from rides the model can see. The 5 unmeasured rides in the window
contributed little or nothing to it, though the work happened, so a share of the usual load is
a share of a number that is, if anything, **too low**. A rider who rode a steady week and had
the strap off for part of it is being assumed to ride a little less than that week. The count
of unmeasured rides is shown under "What this rests on".

## What the projection is not

- **Not a forecast.** Nothing here says what will happen. It says what this arithmetic gives
  if the load is as stated.
- **Not advice.** No scenario is better than another and no form is a target. There is no
  suggested taper, because arithmetic over Garmin's load figures cannot know what an event
  demands.
- **Not a recovery model.** Illness, sleep, travel and heat are not in the series.
- **Not stored.** It is drawn in the pale step of its series, continuous with the history, so
  it is never mistaken for a measurement.

## What the tests pin down

[`src/calc/planning.test.ts`](../src/calc/planning.test.ts):

- the days before today are the stored series, unchanged, and the input map is not mutated;
- under rest, fitness falls by 41/42 and fatigue by 6/7 a day;
- under the usual load, fitness and fatigue hold at that load;
- the event day takes its form and fitness from the eve, and a load placed on it changes
  nothing;
- the before share is fed until the switch date and the after share from it, and a switch on
  today gives no projected day the before share;
- a ride already synced today keeps its load and stays history, and projection starts
  tomorrow;
- the usual load averages the 28 days before today and leaves today out, sums the unmeasured
  rides over the window, and divides by the days there are when the history is short;
- `turnsPositive` is null when form is already non-negative, names the first day a tired
  state crosses zero under rest, and is null when it never crosses;
- the peak takes the earliest day on a plateau, and fitness is the eve's at both the peak and
  the switch;
- the event form is placed among the measured forms only;
- projected days are marked estimated for 42 days after an unmeasured ride;
- `lessSureUntil` is the first clear day, may fall after the event, and is null with no
  unmeasured ride or when the window is clear by today;
- the first thing wrong with a scenario is named as a sentence, and the default scenario, the
  180-day limit and a 60-character name are accepted;
- the default scenario is rest from today for 28 days;
- with no rides, or a history starting today, there is no report;
- the default is projected when nothing is saved, a saved future plan is projected, and a
  saved plan round-trips with a null name and stays one row;
- a plan in the past falls back to the default and is named, and a plan whose event is today
  is neither past nor current;
- a query overrides the saved plan without touching it, and a cleared plan is forgotten.

[`src/routes/planning.test.ts`](../src/routes/planning.test.ts):

- GET with no history returns null, and GET with a query projects it without saving it;
- a bad percentage, a bad date and a partial query are each a 400 with a sentence;
- PUT without a JSON content type is a 415;
- PUT saves a valid plan, trims its name, and GET then reads it back as saved;
- an empty name becomes null, and wrong types and unparseable JSON are a 400;
- an invalid PUT is a 400 that keeps the plan already saved;
- DELETE clears the plan and returns 204, and GET falls back to the default.
