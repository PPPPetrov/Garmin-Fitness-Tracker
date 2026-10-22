import { useApi, type Activity, type LoadDay, type PowerPoint, type Status, type Week } from '../api';
import { BarChart } from '../charts/Bars';
import { LineChart, LineLegend } from '../charts/Line';
import { LoadStrip, StripLegend } from '../charts/LoadStrip';
import {
  DASH,
  duration,
  durationLabel,
  isoDaysAgo,
  km,
  longDate,
  num,
  rideName,
  shortDate,
  signed,
  typeName,
  watts,
} from '../format';

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
  const power = useApi<{ rows: PowerPoint[] }>('/api/power-curve');

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

  /* Every figure below is rounded once, here, and the deltas are the difference of the
     values as displayed — so the arithmetic on screen always closes. */
  const fitness = today ? Math.round(today.fitness) : null;
  const fatigue = today ? Math.round(today.fatigue) : null;
  const form = today ? Math.round(today.form) : null;

  /* The honest comparison for "am I fitter": the same day a year ago. Twelve weeks, read
     in October, measures him against his own August. The curve is fetched from 365 days
     back, so its first row is that day, unless the history is shorter than a year or that
     day still sat inside the 42-day warm-up, when there is nothing to compare with. */
  const yearAgo = rows[0] ?? null;
  const comparable =
    yearAgo != null && yearAgo.local_date <= isoDaysAgo(358) && yearAgo.is_warmup === 0;
  const thenFitness = comparable && yearAgo != null ? Math.round(yearAgo.fitness) : null;
  const change = fitness != null && thenFitness != null ? fitness - thenFitness : null;

  const strip = rows.slice(-90);
  const unmeasured = strip.filter((r) => r.unmeasured_rides > 0).length;

  const peak = rows.reduce(
    (best, r, i) => (r.fitness > (rows[best]?.fitness ?? -Infinity) ? i : best),
    0,
  );

  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];
  const thisWeekHours = thisWeek ? round1(thisWeek.hours) : null;
  const weekChange =
    thisWeekHours != null && lastWeek ? round1(thisWeekHours - round1(lastWeek.hours)) : null;

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
          <p className="finding">
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
                . Form <strong className="fig">{signed(form ?? 0)}</strong>:{' '}
                {(form ?? 0) > 15 ? 'little' : (form ?? 0) > -10 ? 'moderate' : 'heavy'} fatigue
                into today.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="overview-grid">
        <div className="column">
          <div className="kpis">
            <Kpi
              label="Fitness"
              lead
              value={num(fitness)}
              note={
                change == null ? (
                  '42-day average load'
                ) : (
                  <>
                    42-day average load ·{' '}
                    <span className={change < 0 ? 'bad' : 'good'}>{signed(change)}</span> on last
                    year
                  </>
                )
              }
            />
            <Kpi label="Fatigue" value={num(fatigue)} note="7-day average load" />
            <Kpi
              label="Form"
              value={form == null ? DASH : signed(form)}
              note="Fitness minus fatigue, lagged a day. Above zero is fresh."
            />
            <Kpi
              label="This week"
              value={thisWeekHours == null ? DASH : num(thisWeekHours, 1)}
              unit="h"
              note={
                thisWeek == null ? (
                  'No rides this week'
                ) : (
                  <>
                    {num(thisWeek.rides)} ride{thisWeek.rides === 1 ? '' : 's'},{' '}
                    {num(thisWeek.km, 0)} km
                    {weekChange != null && <> · {signed(weekChange, 1)} h on last week</>}
                  </>
                )
              }
            />
          </div>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Fitness and fatigue</h2>
              <LineLegend
                series={[
                  { name: 'Fitness', colour: 'var(--chart-1)' },
                  { name: 'Fatigue', colour: 'var(--chart-grey)' },
                ]}
              />
            </div>
            <LineChart
              labels={rows.map((r) => shortDate(r.local_date))}
              height={274}
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
                  colour: 'var(--chart-grey)',
                  width: 1.25,
                  values: rows.map((r) => r.fatigue),
                },
                {
                  name: 'Fitness',
                  colour: 'var(--chart-1)',
                  width: 2.25,
                  values: rows.map((r) => r.fitness),
                },
              ]}
            />
            <p className="chart-note">
              Last 12 months, in Garmin training-load points. Fitness is the 42-day weighted
              average of daily load and fatigue the 7-day one, so fatigue moves first.
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Every ride, last 90 days</h2>
              <span className="card-note">Training load per day</span>
            </div>
            <LoadStrip days={strip} />
            <div style={{ marginTop: 10 }}>
              <StripLegend />
            </div>
            <p className="chart-note">
              An open column is a day with a ride Garmin gave no usable load: no value at all, or
              a ride recorded without a heart-rate strap, where the figure comes back about eight
              times too low. {num(unmeasured)} of these 90 days are drawn that way.
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Weekly hours</h2>
              <span className="card-note">Last 26 weeks</span>
            </div>
            <BarChart
              labels={weeks.map((w) => shortDate(w.week_start))}
              values={weeks.map((w) => w.hours)}
              yUnit="hours"
              height={200}
            />
            <p className="chart-note">
              Garmin ride time, not moving time: a long café stop counts.
            </p>
          </section>
        </div>

        <div className="column">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Recent rides</h2>
              <span className="card-note">Load</span>
            </div>
            <div className="rows">
              {recent.slice(0, 6).map((a) => (
                <div className="row" key={a.activity_id}>
                  <div className="row-main">
                    <div className="row-name">
                      {rideName(a.activity_name, typeName(a.activity_type))}
                    </div>
                    <div className="row-sub">
                      {shortDate(a.local_date)} · {typeName(a.activity_type)} ·{' '}
                      {duration(a.duration_s)} · <span className="fig">{km(a.distance_m, 0)}</span>{' '}
                      km
                    </div>
                  </div>
                  <div className="row-figure fig">
                    {a.activity_training_load == null ? (
                      <span className="dash">{DASH}</span>
                    ) : (
                      num(a.activity_training_load)
                    )}
                  </div>
                </div>
              ))}
              {recent.length === 0 && <p className="state">No rides imported yet.</p>}
            </div>
            <div className="card-foot">
              <a className="link" href="#activities">
                View all {num(coverage?.total)} rides
              </a>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">What the model can see</h2>
            </div>
            {coverage == null ? (
              <p className="state">Coverage is still loading.</p>
            ) : (
              <>
                <div className="meter-head">
                  <span>
                    <span className="fig">{num(trusted)}</span> rides with a load it can trust
                  </span>
                  <span className="fig">{num(coverage.total)}</span>
                </div>
                <div className="meter">
                  <div
                    className="meter-fill"
                    style={{ width: `${((trusted ?? 0) / coverage.total) * 100}%` }}
                  />
                </div>
                <div className="rows" style={{ marginTop: 12 }}>
                  <KeyValue label="No training load at all" value={num(noLoad)} />
                  <KeyValue label="Recorded without a strap" value={num(noStrap)} />
                  <KeyValue label="With a power-based TSS" value={num(coverage.withTss)} />
                </div>
                <p className="chart-note">
                  Both kinds are counted rather than averaged in.
                </p>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Best power held</h2>
              <span className="card-note">All time</span>
            </div>
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
                    <div className="row-sub">Set {longDate(p.local_date)}</div>
                  </div>
                  <div className="row-figure">
                    <span className="fig">{watts(p.watts)}</span>
                    <span className="unit"> W</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="card-foot">
              <a className="link" href="#trends">
                The whole curve
              </a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Six durations a rider actually talks about, from whatever the curve holds. */
function pickDurations(rows: PowerPoint[]): PowerPoint[] {
  const wanted = [5, 60, 300, 600, 1200, 3600];
  return wanted
    .map((d) => rows.find((r) => r.duration_s === d))
    .filter((r): r is PowerPoint => r != null);
}

function Kpi({
  label,
  value,
  unit,
  note,
  lead,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: React.ReactNode;
  /** The figure that answers the screen's question. One per screen. */
  lead?: boolean;
}) {
  return (
    <div className={lead ? 'kpi kpi-lead' : 'kpi'}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value fig">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ minHeight: 32 }}>
      <div className="row-main">
        <div className="row-name">{label}</div>
      </div>
      <div className="row-figure fig">{value}</div>
    </div>
  );
}

function Failed({ what, message }: { what: string; message: string }) {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Overview</h1>
          <p className="finding">The numbers below could not be read from the local database.</p>
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
          <p className="finding">Reading the local database…</p>
        </div>
      </div>
      <div className="overview-grid">
        <div className="column">
          <div className="kpis">
            {['Fitness', 'Fatigue', 'Form', 'This week'].map((label) => (
              <div className="kpi" key={label}>
                <div className="kpi-label">{label}</div>
                <div className="skeleton skeleton-value" />
                <div className="kpi-note">&nbsp;</div>
              </div>
            ))}
          </div>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Fitness and fatigue</h2>
            </div>
            <div className="skeleton skeleton-plot" style={{ height: 274 }} />
          </section>
        </div>
        <div className="column">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Recent rides</h2>
            </div>
            <div className="rows">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="row" key={i}>
                  <div className="skeleton skeleton-row" style={{ width: '70%' }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
