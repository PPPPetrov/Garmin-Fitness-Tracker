import type { ReactNode } from 'react';
import { useApi, type Async, type PerformanceReport, type PowerCurve } from '../api';
import { LineChart, LineLegend } from '../charts/Line';
import {
  DASH,
  durationLabel,
  heldBackNote,
  longDate,
  monthYear,
  num,
  shortDate,
  signed,
  watts,
} from '../format';
import { Card, Delta } from '../ui';

/** The screen's question: is my body getting stronger, not just busier? */
export function Performance() {
  const report = useApi<PerformanceReport>('/api/performance');

  if (report.state === 'error') return <Failed message={report.message} />;
  if (report.state === 'loading') return <Loading />;

  const { efficiency, criticalPower, ramp, heldBack } = report.data;
  const cpMonths = criticalPower.months;
  const latest = cpMonths[cpMonths.length - 1] ?? null;
  const currentMonth = latest?.month;
  const effMonths = efficiency.months;

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Performance</h1>
          <p className="subtitle">{performanceFinding(report.data)}</p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-1-1-1">
          <Card
            title="Critical power"
            info="The power you could in principle hold indefinitely, fitted from your best 2, 5, 10 and 20 minutes of the last 90 days. W′ is the store of work above it."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">
                  {latest?.cp == null ? DASH : watts(latest.cp)}
                  {latest?.cp != null && <span className="unit"> W</span>}
                </div>
                <div className="caption">{criticalPowerCaption(latest)}</div>
              </div>
            </div>
          </Card>

          <Card
            title="Efficiency"
            info="Normalized power per heartbeat on road rides. More watts for the same heartbeat means a better aerobic engine."
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">
                  {efficiency.recent == null ? DASH : efficiency.recent.toFixed(2)}
                  {efficiency.recent != null && <span className="unit"> W per beat</span>}
                </div>
                <div className="caption">
                  {efficiency.change == null ? (
                    'Needs 5 road rides in each of two three-month spans'
                  ) : (
                    <>
                      <Delta
                        value={efficiency.change}
                        text={`${Math.round(Math.abs(efficiency.change) * 100)}%`}
                        tone={efficiency.change < 0 ? 'bad' : 'good'}
                      />{' '}
                      on {spanLabel(efficiency.beforeSpan)}
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Ramp rate"
            info="How much fitness changed over the last seven days, placed against every week you have measured. The usual ramp limits are in TSS, a different scale from Garmin's load points."
            aside={ramp ? shortDate(ramp.date) : undefined}
          >
            <div className="kpi">
              <div className="kpi-text">
                <div className="figure">
                  {ramp == null ? DASH : signed(ramp.perWeek, 1)}
                  {ramp != null && <span className="unit"> a week</span>}
                </div>
                <div className="caption">
                  {ramp == null
                    ? 'Needs a week past the warm-up'
                    : `${
                        ramp.perWeek >= 0
                          ? `Faster than ${ramp.percentile}% of your weeks`
                          : `Steeper fall than ${ramp.percentAbove}% of your weeks`
                      }${ramp.estimated ? ' · less sure' : ''}`}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Critical power and Garmin's FTP"
            info="Ours from your own best efforts, Garmin's as it stood on the same day. It only knows the efforts you rode: without a hard 5- and 20-minute effort in the last 90 days it reads low, which is why November 2023 shows 110 W."
            aside={
              <LineLegend
                series={[
                  { name: 'Critical power', colour: 'var(--chart-1)' },
                  { name: "Garmin's FTP", colour: 'var(--chart-2)' },
                ]}
              />
            }
          >
            {cpMonths.length === 0 ? (
              <p className="state">No powered ride on file yet, so there is no estimate to draw.</p>
            ) : (
              <>
                <LineChart
                  labels={cpMonths.map((m) => monthYear(`${m.month}-01`))}
                  tipLabels={cpMonths.map((m) =>
                    m.month === currentMonth
                      ? `to ${shortDate(criticalPower.window.to)}`
                      : monthYear(`${m.month}-01`, true),
                  )}
                  height={300}
                  yUnit="watts"
                  format={(v) => `${Math.round(v)} W`}
                  series={[
                    {
                      name: "Garmin's FTP",
                      colour: 'var(--chart-2)',
                      width: 1.5,
                      values: cpMonths.map((m) => m.garminFtp),
                    },
                    {
                      name: 'Critical power',
                      colour: 'var(--chart-1)',
                      width: 2.5,
                      values: cpMonths.map((m) => m.cp),
                    },
                  ]}
                />
                <p className="note">
                  {latest?.cp == null ? (
                    'No powered ride in the last 90 days, so there is no estimate for now.'
                  ) : (
                    <>
                      From <span className="fig">{num(latest.rides)}</span> rides in the 90 days to{' '}
                      {shortDate(criticalPower.window.to)}.
                    </>
                  )}
                </p>
              </>
            )}
          </Card>

          <PowerBySeason />
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Efficiency by month"
            info="The median of each month's road rides, in watts per beat. Indoor rides are left out because heart rate runs differently on a trainer, and heat raises heart rate, so a hot month reads lower."
          >
            {effMonths.length === 0 ? (
              <p className="state">No road ride with power and heart rate yet.</p>
            ) : (
              <>
                <LineChart
                  labels={effMonths.map((m) => monthYear(`${m.month}-01`))}
                  tipLabels={effMonths.map((m) => monthYear(`${m.month}-01`, true))}
                  height={220}
                  yUnit="W per beat"
                  includeZero={false}
                  format={(v) => v.toFixed(2)}
                  series={[
                    {
                      name: 'Efficiency',
                      colour: 'var(--chart-1)',
                      width: 2.5,
                      values: effMonths.map((m) => m.median),
                    },
                  ]}
                />
                <p className="note">
                  <span className="fig">{num(efficiency.rides)}</span> road rides since{' '}
                  {monthYear(`${effMonths[0]!.month}-01`, true)}. Months with fewer than 3 are left
                  out.{' '}
                  {efficiency.thisMonth.rides > 0 && (
                    <>
                      {monthYear(`${efficiency.thisMonth.month}-01`, true).split(' ')[0]} so far:{' '}
                      <span className="fig">
                        {efficiency.thisMonth.median == null
                          ? DASH
                          : efficiency.thisMonth.median.toFixed(2)}
                      </span>{' '}
                      from <span className="fig">{num(efficiency.thisMonth.rides)}</span>{' '}
                      {efficiency.thisMonth.rides === 1 ? 'ride' : 'rides'}.
                    </>
                  )}
                </p>
              </>
            )}
          </Card>

          <Card
            title="What these rest on"
            info="The efforts behind today's critical power, and the rides behind efficiency."
          >
            <div className="rows">
              {[120, 300, 600, 1200].map((duration) => {
                const best = criticalPower.window.bests.find((b) => b.durationS === duration);
                return (
                  <div className="row" key={duration}>
                    <div className="row-main">
                      <div className="row-name">Best {durationLabel(duration)}</div>
                      <div className="row-sub">{best ? longDate(best.date) : 'None in 90 days'}</div>
                    </div>
                    <div className="row-figure">
                      {best ? (
                        <>
                          {watts(best.watts)}
                          <span className="unit"> W</span>
                        </>
                      ) : (
                        <span className="dash">{DASH}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="row">
                <div className="row-main">
                  <div className="row-name">Efficiency rides</div>
                  <div className="row-sub">This month, of all road rides</div>
                </div>
                <div className="row-figure">
                  {num(efficiency.thisMonth.rides)}
                  <span className="unit"> of {num(efficiency.rides)}</span>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <div className="row-name">Held back</div>
                  <div className="row-sub">By the Garmin power check</div>
                </div>
                <div className="row-figure">{num(heldBack)}</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** The one fact on this screen that most needs attention, by the spec's rules in order. */
export function performanceFinding({ efficiency, criticalPower, ramp }: PerformanceReport): ReactNode {
  const latest = criticalPower.months[criticalPower.months.length - 1] ?? null;

  if (ramp != null && ramp.percentile >= 90) {
    return (
      <>
        Fitness is building faster than on 9 in 10 of your weeks:{' '}
        <strong className="fig">{signed(ramp.perWeek, 1)}</strong> a week.
      </>
    );
  }
  if (
    efficiency.change != null &&
    efficiency.recent != null &&
    efficiency.before != null &&
    Math.abs(efficiency.change) >= 0.03
  ) {
    return (
      <>
        Efficiency is {efficiency.change > 0 ? 'up' : 'down'}{' '}
        <strong className="fig">{Math.round(Math.abs(efficiency.change) * 100)}%</strong> on the
        three months before: <strong className="fig">{efficiency.recent.toFixed(2)}</strong> watts
        per beat against <span className="fig">{efficiency.before.toFixed(2)}</span>.
      </>
    );
  }
  if (latest?.cp != null) {
    if (latest.garminFtp == null) {
      return (
        <>
          Critical power is <strong className="fig">{watts(latest.cp)} W</strong>.
        </>
      );
    }
    const gap = Math.round(latest.cp) - Math.round(latest.garminFtp);
    return (
      <>
        Critical power is <strong className="fig">{watts(latest.cp)} W</strong>
        {gap === 0 ? (
          ", level with Garmin's estimate."
        ) : (
          <>
            , <span className="fig">{Math.abs(gap)} W</span> {gap < 0 ? 'under' : 'over'} Garmin's
            estimate.
          </>
        )}
      </>
    );
  }
  if (efficiency.recent != null && efficiency.before != null) {
    return (
      <>
        Efficiency is level with the three months before:{' '}
        <strong className="fig">{efficiency.recent.toFixed(2)}</strong> watts per beat.
      </>
    );
  }
  return 'No powered rides yet, so there is nothing to measure here.';
}

function criticalPowerCaption(
  latest: PerformanceReport['criticalPower']['months'][number] | null,
): ReactNode {
  if (latest?.cp == null || latest.wPrimeJ == null) return 'No powered ride in the last 90 days';
  const wPrime = `W′ ${(latest.wPrimeJ / 1000).toFixed(1)} kJ`;
  if (latest.garminFtp == null) return wPrime;
  const gap = Math.round(latest.cp) - Math.round(latest.garminFtp);
  return (
    <>
      {wPrime} ·{' '}
      {/* Ours under Garmin's is not bad training, so a gap below stays grey. */}
      <Delta value={gap} text={`${Math.abs(gap)} W`} tone={gap > 0 ? 'good' : 'even'} />{' '}
      {gap === 0 ? "level with Garmin's FTP" : `${gap < 0 ? 'under' : 'over'} Garmin's FTP`}
    </>
  );
}

/** "Apr–Jun" for a span of months. */
function spanLabel([from, to]: [string, string]): string {
  const month = (m: string) => monthYear(`${m}-01`).split(' ')[0];
  return `${month(from)}–${month(to)}`;
}

/** The six durations a rider actually talks about. */
const PEAK_DURATIONS = [5, 60, 300, 600, 1200, 3600];

/** This year's bests against the same months of last year. Moved here from Trends. */
function PowerBySeason() {
  /* A season in progress is held against the same span of the one before it. */
  const todayIso = new Date().toISOString().slice(0, 10);
  const year = Number(todayIso.slice(0, 4));
  const monthDay = todayIso.slice(4);

  const thisSeason = useApi<PowerCurve>(`/api/power-curve?since=${year}-01-01`);
  const lastSeason = useApi<PowerCurve>(
    `/api/power-curve?since=${year - 1}-01-01&to=${year - 1}${monthDay}`,
  );

  const powerBySeason = PEAK_DURATIONS.map((duration) => ({
    duration,
    now: peakAt(thisSeason, duration),
    before: peakAt(lastSeason, duration),
  })).filter((p) => p.now != null || p.before != null);
  const heldBack =
    (thisSeason.state === 'ready' ? thisSeason.data.heldBack : 0) +
    (lastSeason.state === 'ready' ? lastSeason.data.heldBack : 0);

  return (
    <Card
      title="Best power by season"
      info="This year against the same months of last year, from the original ride files. Only rides with a power meter are in it."
      aside={`${year} against ${year - 1}`}
      flush
    >
      {thisSeason.state === 'error' && (
        <p className="state state-error" style={{ margin: 16 }}>
          {thisSeason.message}
        </p>
      )}
      {powerBySeason.length === 0 ? (
        thisSeason.state === 'ready' && (
          <p className="state" style={{ margin: 16 }}>
            No ride files parsed yet. Run <code>npm run sync:fit</code> to download them.
          </p>
        )
      ) : (
        <table>
          <thead>
            <tr>
              <th>Duration</th>
              <th className="num">{year}</th>
              <th className="num">{year - 1}</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {powerBySeason.map((p) => (
              <tr key={p.duration}>
                <td style={{ fontWeight: 500 }}>{durationLabel(p.duration)}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {p.now == null ? <span className="dash">{DASH}</span> : `${watts(p.now)} W`}
                </td>
                <td className="num">
                  {p.before == null ? <span className="dash">{DASH}</span> : `${watts(p.before)} W`}
                </td>
                <td className="num">
                  {p.now == null || p.before == null ? (
                    <span className="dash">{DASH}</span>
                  ) : (
                    /* The difference of the two figures as displayed, not of the
                       raw ones: 268.5 and 226.3 are shown as 269 and 226, and a
                       change of 42 beside them does not close. */
                    <span className={p.now < p.before ? 'bad' : 'good'}>
                      {signed(Math.round(p.now) - Math.round(p.before))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {heldBack > 0 && (
        <p className="note" style={{ margin: '4px 16px 12px' }}>
          {heldBackNote(heldBack)}
        </p>
      )}
    </Card>
  );
}

function peakAt(curve: Async<PowerCurve>, duration: number): number | null {
  if (curve.state !== 'ready') return null;
  return curve.data.rows.find((r) => r.duration_s === duration)?.watts ?? null;
}

function Failed({ message }: { message: string }) {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Performance</h1>
          <p className="subtitle">The numbers below could not be read from the local database.</p>
        </div>
      </div>
      <p className="state state-error">
        Could not load the performance figures: {message}. The API server may not be running.
        Start it with <code>npm run dev</code>.
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
          <h1>Performance</h1>
          <p className="subtitle">Reading the local database…</p>
        </div>
      </div>
      <div className="stack">
        <div className="grid grid-1-1-1">
          {['Critical power', 'Efficiency', 'Ramp rate'].map((label) => (
            <Card title={label} key={label}>
              <div className="skeleton skeleton-value" />
              <div className="caption">&nbsp;</div>
            </Card>
          ))}
        </div>
        <div className="grid grid-2-1">
          <Card title="Critical power and Garmin's FTP">
            <div className="skeleton skeleton-plot" style={{ height: 300 }} />
          </Card>
          <Card title="Best power by season">
            <div className="skeleton skeleton-plot" style={{ height: 300 }} />
          </Card>
        </div>
      </div>
    </>
  );
}
