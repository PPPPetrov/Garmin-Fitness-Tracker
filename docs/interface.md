# The interface

The dashboard's design system, so a new screen or a new chart can be added without guessing.
Everything here is in [`web/src/app.css`](../web/src/app.css) as a token or a class, and the
shared pieces are in [`web/src/ui.tsx`](../web/src/ui.tsx).

## The shape

A warm grey frame holds the chrome. The 248px sidebar sits on it: the mark and name in a white
card at the top, the screens under a "Menu" label, and a card at the foot naming the scope —
how many rides, over which years. The work sits on a white sheet inset 12px from the window's
top, right and bottom edges, with 16px corners and a 1px edge. The sheet carries its own 64px
top bar: the ride search on the left, the freshness stamp and the Sync button on the right.

Every block on the sheet is a **card**: a pale header band with the title, its info mark and a
quiet note on the right; a white body; and a footer link only when there is a screen to go to.

```
1440px:
  sheet    = 1440 − 248 sidebar − 12 inset             = 1180
  content  = 1180 − 2 × 1 border − 2 × 24 padding      = 1130
  thirds:   (1130 − 2 × 16) / 3 = 366, two thirds 748  → 748 + 16 + 366 = 1130
  KPIs:     (1130 − 3 × 16) / 4 = 270.5
  six-up:   (1130 − 5 × 16) / 6 = 175
```

One gutter value, 16px, horizontally and vertically. Rows are `grid-4`, `grid-6`, `grid-2-1`,
`grid-1-2`, `grid-1-1` and `grid-1-1-1`; a `column` stacks two cards in one cell. Cards in a row
share a bottom edge, so each row is balanced by its content — chart heights and row counts are
chosen so no card stretches over empty space.

## Its face

**One green, laddered.** The deep step fills the active nav row and the one primary button,
with a white label at 4.9:1. The middle step is every main data mark. The pale steps carry the
areas: tracks, the calendar's lighter days, the zone ramp. Nothing else on the screen has a hue.

The type is **DM Sans** throughout, with tabular figures on every number that is compared or
updates (`.fig`, `.num`, `.figure`).

## Tokens

```css
--ground   #f3f4f0   the frame
--surface  #ffffff   the sheet and the card bodies
--band     #f8f9f6   card header bands
--raised   #f0f2ec   hover, tracks, skeletons, rest days
--border   #e4e7df   card and sheet edges
--rule     #eef0ea   row rules
--control  #d4d8cd   input borders, the zero line in a chart

--text     #161a13   --muted #5c6358   (over 4.5:1 on every surface here)

--accent      #4f7d1d   the active nav row, the Sync button, positive changes
--accent-ink  #2d4a10   the hardest zone
--accent-50…300         #f4f8ee #e6f0d8 #cbe1ad #a5cb76   tints for areas
--chart-1     #67a12f   the main data element
--chart-2     #c3c8b9   the subordinate series
--negative    #c4242a
```

Sizes: title 28 · KPI 28 · card title 14 · body 14 · captions and notes 13 · axis ticks and
table headers 12 · the calendar's weekday labels 11. Radii: sheet 16, card 10, control 8,
chip 6.

## Colour

Colour goes on data, on status and on the one primary action.

- `--chart-1` marks the screen's **main** data element: the fitness line, the load calendar,
  the weekly bars, the gauge, the coverage ring.
- `--chart-2` carries the subordinate series, so fatigue never out-shouts fitness.
- `--positive` / `--negative` say **good or bad, not up or down**. Fitness falling is bad;
  fatigue moving is neither and stays grey. A zero change is grey, never a signal. With a green
  accent, positive is the accent itself rather than a second green.
- The heart-rate zones are ordered, so they are one hue at five steps, palest for zone 1.
- The only filled control on a screen is Sync.

## The screens

Each answers one question, and the biggest block on it is the answer.

| Screen | Question | Shape |
| --- | --- | --- |
| Overview | Am I fitter than I was, and how much fatigue am I carrying into today? | Four KPI cards; the fitness and fatigue chart beside the form gauge; the load calendar and the coverage ring beside the ten most recent rides; weekly hours beside best power |
| Trends | How has the load moved over this period? | A range track in the title row; six KPI cards; training load beside the zones; form beside ride types stacked over untrusted rides; season and biggest-week tables |
| Performance | Is my body getting stronger, not just busier? | Three KPI cards (critical power, efficiency, ramp rate); critical power beside Garmin's FTP, next to power by season; efficiency by month beside the efforts and rides these rest on. No range control |
| Planning | Where would my form be on the day, if I rode this much until then? | Three KPI cards (form and fitness on the day, what is left to go); the projection chart beside the scenario controls; what happens along the way beside what the figures rest on. One saved plan |
| Activities | Find the ride I am thinking of. | A type filter in the title row, one card holding the table, paging in its footer with the range stated |

Under the title of each sits **the finding** — the one fact in today's data that most needs
attention, computed, not written.

The search in the top bar finds rides by name or place, so it always answers on Activities:
typing anywhere moves there and filters as you type. On a phone the top bar has no room for
it and the field sits in the Activities title row instead, bound to the same value.

On Performance the efficiency chart is the one line chart whose scale does not reach zero (`includeZero={false}`): its values sit between about 1.1 and 1.3 watts per beat, and against zero that movement flattens into a line. Every load chart keeps zero, so it reads from nothing.

## Definitions live in the info mark

A card shows figures, not essays. What a figure means — how fitness is averaged, why a
strapless ride's load is discounted — sits behind the ⓘ next to the card's title, a tooltip
that opens on hover, on keyboard focus and on a tap. What stays visible in the body is the
data-dependent caveat: how many days the curve is less sure of, how much ride time the zones
cover.

## The signature element: the load calendar

The last 13 weeks as a calendar: a column per week, Monday at the top, each day filled by its
Garmin training load in four steps (under 60, 60–119, 120–239, 240 and over).

A day carrying a ride Garmin gave no usable load is **hatched** instead of filled. The work
happened; the model cannot see it. Everywhere else in this project that fact is a sentence,
and a sentence is easy to skip — here it is a mark. A rest day is an empty square, days still
to come are not drawn, and today is outlined.

`web/src/charts/LoadCalendar.tsx`. Its legend swatches are the calendar's own cells, scaled
down, so the two cannot drift apart. On a card wider than the calendar needs, its summary and
legend move beside it rather than leaving half the card empty.

## Charts

Hand-drawn SVG in `web/src/charts/`, measured in real pixels with a `ResizeObserver` — a fixed
`viewBox` scaled to its container would render a 12px tick at about 4px on a phone.

- **One question, one chart.** Two series at most, and the second is grey.
- **Straight segments**, broken where data is missing rather than interpolated. No smoothing,
  no point markers, no fills.
- **Gridlines**: 3–5 horizontal lines, no y-axis line. Round, even steps with the top tick
  above the maximum, and the darker line at zero wherever zero is on the scale.
- **X labels**: 5 on a wide plot, 4 on a tablet, 3 on a phone, flat, never rotated, with the
  first and last pulled inside the plot.
- **Hover** on a line chart draws a guide, a ring on each series and a tooltip naming the day.
- **Annotate the event that matters**: a 2px pale marker and a 12px label in a row reserved
  above the plot, and only when there is a label to put there.
- **A projection is drawn in the pale step of its series, continuous with the history.**
- **A period still in progress is drawn pale**: this week's bar, until the week is over.
- On a phone a plot is no taller than 200–220px, so the next card starts on the same screen.

The small pictures follow the same rules: the **gauge** is 41 ticks filled to today's form
percentile, with the figure in its centre as text; the **ring** is one share of a whole; the
**day bars** in the This week card are Monday to Sunday, with days still to come drawn as an
outline so an empty Friday is not read as a rest day yet.

## Tables and rows

12px grey sentence-case headers with a 1px rule under them. No fill band, no zebra striping.
Rows 48px, separated by `--rule`, with a band-tone hover. Numbers right-aligned in tabular
figures with fixed decimals per metric, never wrapping. The identity column gets the most width
and is never the one cut off: long ride names are shortened editorially once, in `format.ts`,
and the same short name is used at every width. The ride type is a neutral pill.

## Data states

- **A real zero prints as a zero.**
- **A missing value is a grey dash** at label size, never a zero and never `--`. One constant,
  `DASH`, in `format.ts`.
- **Loading** is the final layout with each value replaced by a flat grey bar at its real
  size, so nothing shifts when the data lands. No shimmer.
- **An error sits inside the block that failed**, as one sentence plus what to do, never as a
  page-level banner.
- **An empty block keeps its frame and its heading** and adds one sentence.

## The phone and the tablet

Below 1100px the sidebar folds into a sheet behind a menu button in the top bar, which also
names the screen, and the white sheet becomes the screen. Below 900px the two- and three-column
rows stack and the KPI cards go two by two. Below 640px the search moves onto Activities, the
recent rides fold their date, type, time and distance into a subline, and a wide table scrolls
inside its own frame with the date column fixed — the page never scrolls sideways.

The table header sticks below the top bar only at widths where the table has no horizontal
scroller of its own, because that scroller would otherwise capture the sticky positioning.

## What this interface does not do

No gradients, no glows, no glass, no shadows at rest — only the tooltips, which float, carry
one. No icons in tinted squares, no sparklines on KPIs, no emoji, no uppercase tracked labels,
no zebra rows, no placeholder data. Motion is feedback only — hover, focus, press — and nothing
performs an entrance.
