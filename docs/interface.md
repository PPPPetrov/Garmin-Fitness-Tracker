# The interface

The dashboard's design system, so a new screen or a new chart can be added without guessing.
Everything here is in [`web/src/app.css`](../web/src/app.css) as a token or a class.

## The shape

One tinted L-shaped frame holds the chrome: a 228px sidebar and a 48px top bar sharing a
ground, with no rule between them. The work sits on a white sheet inset 8px from the window's
right and bottom edges, with 16px corners, a 1px edge and no shadow.

Depth comes from a single tone step, never from a shadow or a second border. There are three
nesting levels — frame, sheet, card — and no fourth.

```
1440px:
  sheet   = 1440 − 228 sidebar − 8 inset      = 1204
  content = 1204 − 2 × 24 padding             = 1156
  overview: main 748 + 24 gutter + rail 384   = 1156
  trends:   two share tables (1156 − 24) / 2  = 566 each
```

One gutter value, 24px, horizontally and vertically.

## Its face

**IBM Plex Mono on every figure; IBM Plex Sans on everything else.** A training log is read the
way a bike computer is read — watts, load points, bpm, kilometres down a column — so the
numbers get their own drawing. Apply it with `class="fig"`, which also turns on tabular
figures.

The mono goes on KPI values, table cells, row figures and any number inside a sentence. It
does **not** go on chart axis ticks, labels or headings: those stay in the text face, and a
value never changes typeface mid-line (the unit after a number is mono too).

## Tokens

```css
--ground  #f9fbfc   the chrome tint
--surface #ffffff   the sheet and the cards
--raised  #f4f6f8   a fill one step up: share-row bars, disabled controls
--active  #ebedee   the nav pill, a meter's track
--border  #e8eaec   card and sheet edges
--rule    #f0f1f2   row rules inside a table
--control #cdced1   input borders, one step darker than a card

--text    #131416   --muted #5d5f60   (both over 4.5:1 on every surface here)
--primary #131416   the one filled button
--accent  #1b6c80   the mark, focus rings
--positive #1e7b4f  --negative #c4242a

--chart-1    #1b6c80   the main data element
--chart-grey #a9b0b4   the subordinate series
--grid       #eceef0   3–5 hairline gridlines
```

Sizes: title 22 · section 16 · KPI 28 · body 14 · small 12, with 13 and 15 for chart notes and
the finding sentence. Nothing reaches 34px; no figure reaches 48. Radii: sheet 16, card 8,
control 6.

## Colour

Colour goes on data, on status and on the one primary action. The chrome holds none.

- `--chart-1` marks the screen's **main** data element: the fitness line, the load strip's
  columns, the weekly bars, the coverage meter's fill. Not a secondary chart, not a delta.
- `--chart-grey` carries the subordinate series, so fatigue never out-shouts fitness.
- `--positive` / `--negative` say **good or bad, not up or down**. Fitness falling is bad;
  fatigue falling is not. A zero or undefined change is grey, never a signal.
- The only filled control on a screen is Sync, in near-black.

## The screens

Each answers one question, and the biggest block on it is the answer.

| Screen | Question | Shape |
| --- | --- | --- |
| Overview | Am I fitter than I was, and how much fatigue am I carrying into today? | KPI strip, the form placing, main chart, the load strip, weekly hours; a 384px rail of recent rides, coverage and best powers |
| Trends | How has the load moved over this period, and what are my best powers? | No cards: a 6-figure row, two full-width charts, the zone share table, then a 2 × 2 grid of small tables whose rows align across the columns |
| Activities | Find the ride I am thinking of. | Filters, one full-width table, paging with the range stated |

Under the title of each sits **the finding** — the one fact in today's data that most needs
attention, computed, not written: where fitness stands against twelve weeks ago, how many of
the last 90 days the model could not measure.

## The signature element: the 90-day load strip

One column per day, its height that day's training load.

A day carrying a ride Garmin gave no usable load is drawn as an **open hatched column** at a
fixed floor height instead of a solid one. The work happened; the model cannot see it.
Everywhere else in this project that fact is a sentence, and a sentence is easy to skip — here
it is a mark. A rest day is the baseline, not a zero-height bar.

`web/src/charts/LoadStrip.tsx`. Its legend swatch is the mark itself, scaled down, so the two
cannot drift apart.

## Charts

Hand-drawn SVG in `web/src/charts/`, measured in real pixels with a `ResizeObserver` — a fixed
`viewBox` scaled to its container would render a 12px tick at about 4px on a phone.

- **One question, one chart.** Two series at most, and the second is grey.
- **Straight segments**, broken where data is missing rather than interpolated. No smoothing,
  no point markers, no fills.
- **Gridlines**: 3–5 horizontal hairlines, no y-axis line. Round, even steps with the top tick
  above the maximum, and the heavy line at zero wherever zero is on the scale.
- **X labels**: 5 on a wide plot, 4 on a tablet, 3 on a phone, flat, never rotated, with the
  first and last pulled inside the plot.
- **No legend for a single series** — the heading names it. Otherwise a dot legend in the card
  header, each swatch the mark it explains.
- **Annotate the event that matters**: a 1px marker and a 12px label in a row reserved above
  the plot, and only when there is a label to put there.

## Tables and rows

12px grey sentence-case headers with a 1px rule under them. No fill band, no zebra striping.
Rows 48px, separated by `--rule`. Numbers right-aligned in tabular mono with fixed decimals
per metric. The identity column gets the most width and is never the one cut off: long ride
names are shortened editorially once, in `format.ts`, and the same short name is used at every
width.

Two measures stack in one cell rather than taking two columns — a ride's name over its place
and the reason its load is untrustworthy.

## Data states

- **A real zero prints as a zero.**
- **A missing value is a grey dash** at label size, never a zero and never `--`. One constant,
  `DASH`, in `format.ts`.
- **Loading** is the final layout with each value replaced by a flat grey bar at its real
  size, so nothing shifts when the data lands. No shimmer.
- **An error sits inside the block that failed**, as one sentence plus what to do, never as a
  page-level banner.
- **An empty block keeps its frame and its heading** and adds one sentence.

## The phone

Below 1100px the sidebar folds into a sheet behind a menu button in the 48px top bar, and the
white sheet becomes the screen. Below 640px the KPI container becomes a 2 × 2 grid with its
dividers intact, the Overview rail stacks under the main column, the share tables go to one
column, and a wide table scrolls inside its own frame — the page never scrolls sideways.

The table header sticks below the top bar only at widths where the table has no horizontal
scroller of its own, because that scroller would otherwise capture the sticky positioning.

## What this interface does not do

No gradients, no glows, no glass, no shadows at rest. No icons in tinted squares, no
sparklines on KPIs, no icon-topped cards, no emoji, no uppercase tracked labels, no zebra
rows, no placeholder data. Motion is feedback only — hover, focus, press — and nothing
performs an entrance.
