import {
  useApi,
  type Activity,
  type FormBand,
  type FormPosition,
  type FormReading,
  type LoadDay,
  type PowerCurve,
  type PowerPoint,
  type Status,
  type Week,
} from '../api';
import { BarChart } from '../charts/Bars';
import { DayBars } from '../charts/DayBars';
import { Gauge, Ring } from '../charts/Gauge';
import { LineChart, LineLegend } from '../charts/Line';
import { CalendarLegend, LoadCalendar, LOAD_STEPS } from '../charts/LoadCalendar';
import {
  addDays,
  DASH,
  duration,
  durationLabel,
  heldBackNote,
  isoDaysAgo,
  km,
  longDate,
  mondayOf,
  num,
  rideName,
  shortDate,
  signed,
  typeName,
  watts,
} from '../format';
import { Card, Delta, More } from '../ui';

interface OverviewData {
  today: LoadDay | null;
  weeks: Week[];
  recent: Activity[];
}

/** The screen's question: am I fitter than I was, and what am I carrying into today? */
export function Overview() {
  const overview = useApi<OverviewData>('/api/overview');
  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${isoDaysAgo(365)}`);
  const status = useApi<Status>('/api/status');
  const power = useApi<PowerCurve>('/api/power-curve');
  const reading = useApi<FormReading>('/api/form');

  if (overview.state === 'error') {
    return <Failed what="the overview" message={overview.message} />;
  }
  if (load.state === 'error') {
    return <Failed what="the load curve" message={load.message} />;
  }
  if (overview.state === 'loading' || load.state === 'loading') {
    return <Loading />;
  }

  const { today, weeks, recent } = overview.data;
  const rows = load.data.rows;
  const todayIso = isoDaysAgo(0);

  /* Every figure below is rounded once, here, and the deltas are the difference of the
     values as displayed — so the arithmetic on screen always closes. */
  const fitness = today ? Math.round(today.fitness) : null;
  const fatigue = today ? Math.round(today.fatigue) : null;
  const form = today ? Math.round(today.form) : null;
  const position = reading.state === 'ready' ? reading.data.position : null;

  /* The honest comparison for "am I fitter": the same day a year ago. Twelve weeks, read
     in October, measures him against his own August. The curve is fetched from 365 days
     back, so its first row is that day, unless the history is shorter than a year or that
     day still sat inside the 42-day warm-up, when there is nothing to compare with. */
  const yearAgo = rows[0] ?? null;
  const comparable =
    yearAgo != null && yearAgo.local_date <= isoDaysAgo(358) && yearAgo.is_warmup === 0;
  const thenFitness = comparable && yearAgo != null ? Math.round(yearAgo.fitness) : null;
  const change = fitness != null && thenFitness != null ? fitness - thenFitness : null;

  /* Fatigue against a week ago is neither good nor bad on its own, so it stays grey. */
  const weekAgo = rows.length > 7 ? rows[rows.length - 8] : null;
  const fatigueChange =
    fatigue != null && weekAgo != null ? fatigue - Math.round(weekAgo.fatigue) : null;

  const peak = rows.reduce(
    (best, r, i) => (r.fitness > (rows[best]?.fitness ?? -Infinity) ? i : best),
    0,
  );
  const estimated = rows.filter((r) => r.is_estimated === 1).length;

  /* This week, Monday to today, from the ten most recent rides. If all ten fall inside the
     week there may be more, and the days cannot be drawn honestly from them. */
  const monday = mondayOf(todayIso);
  const thisWeekRides = recent.filter((a) => a.local_date >= monday);
  const weekComplete = thisWeekRides.length < recent.length;
  const secondsByDay = new Map<string, number>();
  for (const a of thisWeekRides) {
    secondsByDay.set(a.local_date, (secondsByDay.get(a.local_date) ?? 0) + (a.duration_s ?? 0));
  }
  const thisWeek = weeks.find((w) => mondayOf(w.week_start) === monday) ?? null;

  /* 26 Monday-weeks, including the ones without a ride, which the rollup leaves out. */
  const weekHours = new Map<string, number>();
  for (const w of weeks) {
    const key = mondayOf(w.week_start);
    weekHours.set(key, (weekHours.get(key) ?? 0) + w.hours);
  }
  const mondays = Array.from({ length: 26 }, (_, k) => addDays(monday, -7 * (25 - k)));
  const hoursByWeek = mondays.map((m) => weekHours.get(m) ?? 0);
  const fullWeeks = hoursByWeek.slice(0, -1);
  const averageHours = fullWeeks.reduce((sum, h) => sum + h, 0) / Math.max(1, fullWeeks.length);

  /* The calendar's thirteen weeks, totalled from the same rows it draws. */
  const calendarStart = addDays(monday, -7 * 12);
  const calendarDays = rows.filter((r) => r.local_date >= calendarStart);
  const calendarRides = calendarDays.reduce((sum, r) => sum + r.ride_count, 0);
  const ridingDays = calendarDays.filter((r) => r.ride_count > 0).length;
  const unmeasuredDays = calendarDays.filter((r) => r.unmeasured_rides > 0).length;

  const coverage = status.state === 'ready' ? status.data.fieldCoverage : null;
  const trusted = coverage ? coverage.total - coverage.unreliableLoad : null;
  const noLoad = coverage ? coverage.total - coverage.withLoad : null;
  const noStrap = coverage && noLoad != null ? coverage.unreliableLoad - noLoad : null;

  const bests = power.state === 'ready' ? pickDurations(power.data.rows) : [];

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Overview</h1>
          <p className="subtitle">
            {fitness == null ? (
              'No rides imported yet. Run a sync to build the curve.'
            ) : (
              <>
                Fitness is <strong className="fig">{num(fitness)}</strong> points
                {change != null && (
                  <>
                    , <strong className="fig">{signed(change)}</strong> on this day last year
                  </>
                )}
                . Form <strong className="fig">{signed(form ?? 0)}</strong>
                {position != null && <> sits in {BAND_LABEL[position.band]}</>}.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <Card
            title="Fitness"
            info="The 42-day weighted average of daily Garmin training load: what months of riding have built."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">{num(fitness)}</div>
                <div className="caption">
                  {change == null ? (
                    '42-day average load'
                  ) : (
                    <>
                      <Delta
                        value={change}
                        text={num(Math.abs(change))}
                        tone={change < 0 ? 'bad' : 'good'}
                      />{' '}
                      on this day last year
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Fatigue"
            info="The 7-day weighted average of daily training load: how much of the last week you are still carrying."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">{num(fatigue)}</div>
                <div className="caption">
                  {fatigueChange == null ? (
                    '7-day average load'
                  ) : (
                    <>
                      <Delta
                        value={fatigueChange}
                        text={num(Math.abs(fatigueChange))}
                        tone="even"
                      />{' '}
                      on a week ago
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Form"
            info="Fitness minus fatigue, lagged a day. Above zero you are fresher than your training; below it you are carrying the work. Neither is a measurement of recovery."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">{form == null ? DASH : signed(form)}</div>
                <div className="caption">Fitness minus fatigue</div>
              </div>
            </div>
          </Card>

          <Card
            title="This week"
            info="Garmin ride time since Monday, not moving time: a long café stop counts."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">
                  {thisWeek == null ? '0.0' : num(round1(thisWeek.hours), 1)}
                  <span className="unit">h</span>
                </div>
                <div className="caption">
                  {thisWeek == null ? (
                    'No rides since Monday'
                  ) : (
                    <>
                      <span className="fig">{num(thisWeek.rides)}</span> ride
                      {thisWeek.rides === 1 ? '' : 's'} ·{' '}
                      <span className="fig">{num(thisWeek.km, 0)}</span> km
                    </>
                  )}
                </div>
              </div>
              {weekComplete && <DayBars monday={monday} today={todayIso} seconds={secondsByDay} />}
            </div>
          </Card>
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Fitness and fatigue"
            info="In Garmin training-load points. Fitness is the 42-day weighted average of daily load and fatigue the 7-day one, so fatigue moves first."
            aside={
              <LineLegend
                series={[
                  { name: 'Fitness', colour: 'var(--chart-1)' },
                  { name: 'Fatigue', colour: 'var(--chart-2)' },
                ]}
              />
            }
          >
            <LineChart
              labels={rows.map((r) => shortDate(r.local_date))}
              tipLabels={rows.map((r) => longDate(r.local_date))}
              height={300}
              yUnit="points"
              annotations={
                rows[peak]
                  ? [
                      {
                        index: peak,
                        value: rows[peak].fitness,
                        label: `Peak ${num(rows[peak].fitness)} · ${shortDate(rows[peak].local_date)}`,
                      },
                    ]
                  : []
              }
              series={[
                {
                  name: 'Fatigue',
                  colour: 'var(--chart-2)',
                  width: 1.5,
                  values: rows.map((r) => r.fatigue),
                },
                {
                  name: 'Fitness',
                  colour: 'var(--chart-1)',
                  width: 2.5,
                  values: rows.map((r) => r.fitness),
                },
              ]}
            />
            <p className="note">
              Last 12 months.
              {estimated > 0 && (
                <>
                  {' '}
                  <span className="fig">{num(estimated)}</span> of these{' '}
                  <span className="fig">{num(rows.length)}</span> days sit within 42 days of a ride
                  the model cannot measure, so the curve runs below the real work there.
                </>
              )}
            </p>
          </Card>

          <Card
            title="Where the form sits"
            info="Today's form placed among every measured day of your own history. A +12 is a good day for one rider and a flat one for another, so the dial is yours, not a norm."
            aside={
              position != null && (
                <span>
                  <span className="fig">{num(position.measuredDays)}</span> days
                </span>
              )
            }
            foot={<More href="#trends">Form over time</More>}
          >
            {reading.state === 'error' && <p className="state state-error">{reading.message}</p>}
            {reading.state === 'loading' && (
              <div className="skeleton skeleton-plot" style={{ height: 160 }} />
            )}
            {reading.state === 'ready' && position == null && (
              <p className="state">
                The history is still inside its 42-day warm-up, so there is nothing to place today
                against yet.
              </p>
            )}
            {position != null && (
              <>
                <Gauge
                  value={position.percentile / 100}
                  label={`Form is higher than ${position.percentile}% of measured days`}
                  ends={['Hardest', 'Freshest']}
                  centre={
                    <>
                      <div className="figure">{signed(position.form, 0)}</div>
                      <div className="caption">
                        Higher than <span className="fig">{position.percentile}%</span> of days
                      </div>
                    </>
                  }
                />
                <p className="note" style={{ marginBottom: 12 }}>
                  {placing(position)}
                </p>
                <div className="rows">
                  <KeyValue
                    label={`Form over ${position.change.days} days`}
                    value={signed(position.change.form)}
                  />
                  <KeyValue
                    label={`Fitness over ${position.change.days} days`}
                    value={signed(position.change.fitness)}
                    tone={
                      position.change.fitness < 0
                        ? 'bad'
                        : position.change.fitness > 0
                          ? 'good'
                          : undefined
                    }
                  />
                  <KeyValue
                    label={`Last in ${BAND_SHORT[position.band]}`}
                    value={position.lastInBand ? longDate(position.lastInBand) : 'Never before'}
                  />
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="grid grid-1-2">
          <div className="column">
            <Card
              title="Load by day"
              info={`Each square is a day, filled by its Garmin training load: under ${LOAD_STEPS[0]}, ${LOAD_STEPS[0]}–${LOAD_STEPS[1]! - 1}, ${LOAD_STEPS[1]}–${LOAD_STEPS[2]! - 1}, and ${LOAD_STEPS[2]} points or more. A hatched square is a ride Garmin gave no usable load: no value at all, or no heart-rate strap, where the figure comes back about eight times too low.`}
              aside="Last 13 weeks"
              bodyClassName="calendar-body"
            >
              <div className="calendar-layout">
                <div className="headline">
                  <div className="figure">
                    {num(calendarRides)}
                    <span className="unit">rides</span>
                  </div>
                  <div className="caption">
                    on <span className="fig">{num(ridingDays)}</span> days ·{' '}
                    <span className="fig">{num(unmeasuredDays)}</span> not measured
                  </div>
                </div>
                <LoadCalendar days={calendarDays} today={todayIso} />
                <CalendarLegend />
              </div>
            </Card>

            <Card
              title="What the model can see"
              info="A ride with no training load at all, or one recorded without a heart-rate strap, where Garmin's figure comes back about eight times too low, cannot feed the fitness curve. Both kinds are counted here rather than averaged in."
              aside="All rides"
            >
              {coverage == null ? (
                <div className="skeleton skeleton-plot" style={{ height: 84 }} />
              ) : (
                <>
                  <div className="ring-block">
                    <Ring
                      share={(trusted ?? 0) / Math.max(1, coverage.total)}
                      label={`${num(trusted)} of ${num(coverage.total)} rides carry a load the model can trust`}
                    />
                    <div>
                      <div className="figure figure-sm">
                        {num(trusted)}
                        <span className="unit">of {num(coverage.total)}</span>
                      </div>
                      <div className="caption">rides carry a load it can trust</div>
                    </div>
                  </div>
                  <div className="rows">
                    <KeyValue label="No training load at all" value={num(noLoad)} />
                    <KeyValue label="Recorded without a strap" value={num(noStrap)} />
                    <KeyValue label="With a power-based TSS" value={num(coverage.withTss)} />
                  </div>
                </>
              )}
            </Card>
          </div>

          <Card
            title="Recent rides"
            aside="Load is Garmin training load"
            flush
            foot={
              <More href="#activities" accent>
                View all {num(status.state === 'ready' ? status.data.coverage.total : null)} rides
              </More>
            }
          >
            {recent.length === 0 ? (
              <p className="state" style={{ margin: 16 }}>
                No rides imported yet.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="hide-phone">Date</th>
                    <th>Ride</th>
                    <th className="hide-phone">Type</th>
                    <th className="num hide-phone">Time</th>
                    <th className="num hide-phone">km</th>
                    <th className="num">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, RECENT_ROWS).map((a) => {
                    const flag = unusableLoad(a);
                    return (
                      <tr key={a.activity_id}>
                        <td className="date hide-phone fig">{shortDate(a.local_date)}</td>
                        <td className="name">
                          <div className="cell-name">
                            {rideName(a.activity_name, typeName(a.activity_type))}
                          </div>
                          {flag && <div className="sub hide-phone">{flag}</div>}
                          <div className="sub phone-only">
                            {shortDate(a.local_date)} · {typeName(a.activity_type)} ·{' '}
                            {duration(a.duration_s)} · {km(a.distance_m, 0)} km
                          </div>
                        </td>
                        <td className="hide-phone">
                          <span className="pill">{typeName(a.activity_type)}</span>
                        </td>
                        <td className="num hide-phone">{duration(a.duration_s)}</td>
                        <td className="num hide-phone">{km(a.distance_m)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {a.activity_training_load == null ? (
                            <span className="dash">{DASH}</span>
                          ) : (
                            num(a.activity_training_load)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Weekly hours"
            info="Garmin ride time, not moving time: a long café stop counts. This week is drawn pale until it is over."
            aside="Last 26 weeks"
          >
            <div className="headline">
              <div className="figure">
                {num(averageHours, 1)}
                <span className="unit">h</span>
              </div>
              <div className="caption">
                a week on average over the last <span className="fig">{fullWeeks.length}</span> full
                weeks
              </div>
            </div>
            <BarChart
              labels={mondays.map(shortDate)}
              values={hoursByWeek}
              pale={mondays.map((m) => m === monday)}
              titles={mondays.map(
                (m, i) =>
                  `Week of ${longDate(m)} · ${num(hoursByWeek[i], 1)} h${m === monday ? ' so far' : ''}`,
              )}
              yUnit="hours"
              height={300}
            />
          </Card>

          <Card
            title="Best power held"
            info="The highest average power held for each duration, from the original ride files. Only rides with a power meter count, so none of the mountain biking is in it."
            aside="All time"
            foot={<More href="#trends">Power by season</More>}
          >
            {power.state === 'error' && <p className="state state-error">{power.message}</p>}
            {power.state === 'ready' && bests.length === 0 && (
              <p className="state">
                No ride files parsed yet. Run <code>npm run sync:fit</code>.
              </p>
            )}
            <div className="rows">
              {bests.map((p) => (
                <div className="row" key={p.duration_s}>
                  <div className="row-main">
                    <div className="row-name">{durationLabel(p.duration_s)}</div>
                    <div className="row-sub">{longDate(p.local_date)}</div>
                  </div>
                  <div className="row-figure">
                    {watts(p.watts)}
                    <span className="unit"> W</span>
                  </div>
                </div>
              ))}
            </div>
            {power.state === 'ready' && power.data.heldBack > 0 && (
              <p className="note">{heldBackNote(power.data.heldBack)}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* As many rides as the two cards beside them are tall, so the row ends on one line. */
const RECENT_ROWS = 10;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The same test the load model uses, so a row flagged here is a row the curve discounts:
 * no training load at all, or no heart-rate strap on a ride long enough to matter.
 */
function unusableLoad(a: Activity): string | null {
  if (a.activity_training_load == null) return 'No training load';
  if (a.avg_hr == null && (a.duration_s ?? 0) > 600) return 'No heart-rate strap';
  return null;
}

/** Six durations a rider actually talks about, from whatever the curve holds. */
function pickDurations(rows: PowerPoint[]): PowerPoint[] {
  const wanted = [5, 60, 300, 600, 1200, 3600];
  return wanted
    .map((d) => rows.find((r) => r.duration_s === d))
    .filter((r): r is PowerPoint => r != null);
}

/**
 * The fifths of the rider's own form distribution, named from the fresh end down.
 * No absolute number appears here: a +12 is a good day for one rider and a flat one
 * for another, and the whole point of the band is that it is this rider's.
 */
const BAND_LABEL: Record<FormBand, string> = {
  freshest: 'your freshest fifth',
  fresh: 'your second-freshest fifth',
  typical: 'your middle fifth',
  tired: 'your second-hardest fifth',
  buried: 'your hardest fifth',
};

const BAND_SHORT: Record<FormBand, string> = {
  freshest: 'the freshest fifth',
  fresh: 'the second-freshest fifth',
  typical: 'the middle fifth',
  tired: 'the second-hardest fifth',
  buried: 'the hardest fifth',
};

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * Where today stands. At either extreme the rank is the vivid and honest figure —
 * "the 5th freshest day in 1,430" says something a percentile rounds away — and in
 * the broad middle the percentile, already on the dial, is the one that means anything.
 */
function placing(p: FormPosition): React.ReactNode {
  const total = <span className="fig">{num(p.measuredDays)}</span>;
  const where =
    p.rank <= 10 ? (
      <>
        The <span className="fig">{ordinal(p.rank)}</span> freshest day in {total}
      </>
    ) : p.rank > p.measuredDays - 10 ? (
      <>
        The <span className="fig">{ordinal(p.measuredDays - p.rank + 1)}</span> hardest day in{' '}
        {total}
      </>
    ) : (
      <>In {BAND_SHORT[p.band]}</>
    );

  return (
    <>
      {where}, and the <span className="fig">{ordinal(p.streak)}</span> day running{' '}
      {p.form >= 0 ? 'above' : 'below'} zero.
    </>
  );
}

function KeyValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  /* Good or bad, never up or down: fitness falling is bad, fatigue falling is not. */
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="row row-tight">
      <div className="row-main">
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)' }}>
          {label}
        </div>
      </div>
      <div className={tone ? `row-figure ${tone}` : 'row-figure'}>{value}</div>
    </div>
  );
}

function Failed({ what, message }: { what: string; message: string }) {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Overview</h1>
          <p className="subtitle">The numbers below could not be read from the local database.</p>
        </div>
      </div>
      <p className="state state-error">
        Could not load {what}: {message}. The API server may not be running. Start it with{' '}
        <code>npm run dev</code>.
      </p>
    </>
  );
}

/** The final layout with each value a flat bar at its real size: nothing shifts. */
function Loading() {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Overview</h1>
          <p className="subtitle">Reading the local database…</p>
        </div>
      </div>
      <div className="stack">
        <div className="grid grid-4">
          {['Fitness', 'Fatigue', 'Form', 'This week'].map((label) => (
            <Card title={label} key={label}>
              <div className="skeleton skeleton-value" />
              <div className="caption">&nbsp;</div>
            </Card>
          ))}
        </div>
        <div className="grid grid-2-1">
          <Card title="Fitness and fatigue">
            <div className="skeleton skeleton-plot" style={{ height: 300 }} />
          </Card>
          <Card title="Where the form sits">
            <div className="skeleton skeleton-plot" style={{ height: 300 }} />
          </Card>
        </div>
      </div>
    </>
  );
}
