import { useState } from 'react';
import {
  useApi,
  type Async,
  type FtpStep,
  type LoadDay,
  type PowerPoint,
  type RideType,
  type Season,
  type Week,
  type ZoneReading,
  type ZoneTotals,
} from '../api';
import { LineChart, LineLegend } from '../charts/Line';
import {
  DASH,
  durationLabel,
  isoDaysAgo,
  longDate,
  monthYear,
  num,
  pct,
  shortDate,
  signed,
  typeName,
  watts,
} from '../format';

const RANGES = [
  { id: '12w', label: '12 weeks', days: 84 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'all', label: 'All', days: 3000 },
] as const;

/** The screen's question: how has the load moved over this period, and what are my bests? */
export function Trends() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const from = isoDaysAgo(range.days);

  /* A season in progress is held against the same span of the one before it, so both
     the volume table and the power table stop on the same day of the year. */
  const todayIso = new Date().toISOString().slice(0, 10);
  const year = Number(todayIso.slice(0, 4));
  const monthDay = todayIso.slice(4);

  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${from}`, [range.id]);
  const weeks = useApi<{ rows: Week[] }>(`/api/weeks?from=${from}`, [range.id]);
  const types = useApi<{ rows: RideType[] }>('/api/types');
  const ftp = useApi<{ steps: FtpStep[] }>('/api/ftp');
  const seasons = useApi<{ rows: Season[] }>('/api/seasons');
  const zones = useApi<ZoneReading>(`/api/zones?from=${from}`, [range.id]);
  const thisSeason = useApi<{ rows: PowerPoint[] }>(`/api/power-curve?since=${year}-01-01`);
  const lastSeason = useApi<{ rows: PowerPoint[] }>(
    `/api/power-curve?since=${year - 1}-01-01&to=${year - 1}${monthDay}`,
  );

  const rows = load.state === 'ready' ? load.data.rows : [];
  const wide = range.days > 200;

  const latest = rows[rows.length - 1] ?? null;
  const peakIndex = rows.reduce(
    (best, r, i) => (r.fitness > (rows[best]?.fitness ?? -Infinity) ? i : best),
    0,
  );
  const peak = rows[peakIndex] ?? null;
  const estimated = rows.filter((r) => r.is_estimated === 1).length;

  const weekRows = weeks.state === 'ready' ? weeks.data.rows : [];
  const rides = weekRows.reduce((total, w) => total + w.rides, 0);
  const hoursTotal = weekRows.reduce((total, w) => total + w.hours, 0);

  const biggest = [...weekRows].sort((a, b) => b.hours - a.hours).slice(0, 6);
  const typeRows = types.state === 'ready' ? types.data.rows : [];

  /* Garmin dates every change it makes to the estimate, so the line is a true step:
     for each day in the range, the figure that was in effect on it. A day before the
     first powered ride has none, and stays null rather than becoming a zero. */
  const steps = ftp.state === 'ready' ? ftp.data.steps : [];
  const ftpByDay = rows.map((day) => {
    let inForce: number | null = null;
    for (const step of steps) {
      if (step.from > day.local_date) break;
      inForce = step.watts;
    }
    return inForce;
  });
  const ftpNow = ftpByDay.length > 0 ? ftpByDay[ftpByDay.length - 1] : null;
  const ftpThen = ftpByDay.find((w): w is number => w != null) ?? null;

  const seasonRows = seasons.state === 'ready' ? seasons.data.rows : [];
  const powerBySeason = PEAK_DURATIONS.map((duration) => ({
    duration,
    now: peakAt(thisSeason, duration),
    before: peakAt(lastSeason, duration),
  })).filter((p) => p.now != null || p.before != null);
  /* The bar and the percentage beside it are the same number, so a row can never say
     two things: here the share of all rides, below the share of that type's own rides. */
  const typeTotal = typeRows.reduce((sum, t) => sum + t.n, 0);

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Trends</h1>
          <p className="finding">
            {rows.length === 0
              ? 'No days in this range yet.'
              : `Training load over ${range.label.toLowerCase()}, and the best power held at each duration.`}
          </p>
        </div>
        <div className="title-actions">
          <div className="seg" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={r.id === range.id}
                onClick={() => setRange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Figure label="Fitness" value={latest ? num(latest.fitness) : DASH} note="42-day average" />
        <Figure label="Fatigue" value={latest ? num(latest.fatigue) : DASH} note="7-day average" />
        <Figure
          label="Form"
          value={latest ? signed(Math.round(latest.form)) : DASH}
          note="Fitness minus fatigue"
        />
        <Figure
          label="Peak fitness"
          value={peak ? num(peak.fitness) : DASH}
          note={peak ? `Reached ${longDate(peak.local_date)}` : 'No days in range'}
        />
        <Figure
          label="Rides"
          value={weeks.state === 'ready' ? num(rides) : DASH}
          note="In this range"
        />
        <Figure
          label="Hours"
          value={weeks.state === 'ready' ? num(hoursTotal, 0) : DASH}
          note="Garmin ride time"
        />
      </div>

      <section className="band">
        <div className="band-head">
          <h2 className="band-title">Training load</h2>
          <LineLegend
            series={[
              { name: 'Fitness', colour: 'var(--chart-1)' },
              { name: 'Fatigue', colour: 'var(--chart-grey)' },
            ]}
          />
        </div>
        <p className="band-desc">
          Fitness is the 42-day weighted average of daily training load; fatigue is the 7-day one,
          so it rises and falls first.
        </p>
        {load.state === 'loading' && <div className="skeleton skeleton-plot" style={{ height: 240 }} />}
        {load.state === 'error' && <p className="state state-error">{load.message}</p>}
        {load.state === 'ready' && rows.length > 0 && (
          <>
            <LineChart
              labels={rows.map((r) => (wide ? monthYear(r.local_date) : shortDate(r.local_date)))}
              height={240}
              yUnit="points"
              annotations={
                peak
                  ? [
                      {
                        index: peakIndex,
                        value: peak.fitness,
                        label: `Peak ${num(peak.fitness)}`,
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
              {estimated > 0 ? (
                <>
                  <span className="fig">{num(estimated)}</span> of{' '}
                  <span className="fig">{num(rows.length)}</span> days here sit within 42 days of a
                  ride whose load is missing or was recorded without a heart-rate strap, so the
                  curve runs below the real work on them.
                </>
              ) : (
                'Every ride in this range carried a usable training load.'
              )}
            </p>
          </>
        )}
        {load.state === 'ready' && rows.length === 0 && (
          <p className="state">No days in this range.</p>
        )}
      </section>

      <section className="band">
        <h2 className="band-title">Form</h2>
        <p className="band-desc">
          Fitness minus fatigue, lagged a day. Above the line you are fresh; below it you are
          carrying the week’s work.
        </p>
        {load.state === 'ready' && rows.length > 0 && (
          <LineChart
            labels={rows.map((r) => (wide ? monthYear(r.local_date) : shortDate(r.local_date)))}
            height={180}
            yUnit="points"
            reference={{ value: 0 }}
            series={[
              {
                name: 'Form',
                colour: 'var(--chart-1)',
                width: 1.75,
                values: rows.map((r) => r.form),
              },
            ]}
          />
        )}
        {load.state === 'loading' && <div className="skeleton skeleton-plot" style={{ height: 180 }} />}
      </section>

      <section className="band">
        <div className="band-head">
          <h2 className="band-title">Time in heart-rate zone</h2>
          {zones.state === 'ready' && zones.data.period.rides > 0 && (
            <span className="card-note">
              <span className="fig">{num(zones.data.period.rides)}</span> of{' '}
              <span className="fig">{num(zones.data.period.ridesTotal)}</span> rides carry zones
            </span>
          )}
        </div>
        <p className="band-desc">
          What kind of riding this was, rather than how much of it. These are the only intensity
          figures here that reach the mountain biking, which has no power meter.
        </p>

        {zones.state === 'error' && <p className="state state-error">{zones.message}</p>}
        {zones.state === 'loading' && (
          <div className="skeleton skeleton-plot" style={{ height: 230 }} />
        )}
        {zones.state === 'ready' && zones.data.period.rides === 0 && (
          <p className="state">
            No ride in this period carries zone data. Garmin began reporting the buckets partway
            through the history, and nothing before 2024 has them.
          </p>
        )}

        {zones.state === 'ready' && zones.data.period.rides > 0 && (
          <>
            <div className="share">
              {zones.data.period.seconds.map((seconds, i) => (
                <div className="share-row" key={i}>
                  <div
                    className="share-fill"
                    style={{
                      width: `${(seconds / Math.max(1, zones.data.period.zoneSeconds)) * 100}%`,
                    }}
                  />
                  <span className="share-label">Zone {i + 1}</span>
                  <span className="share-figures">
                    <span className="share-pct fig">
                      {pct(seconds, zones.data.period.zoneSeconds)}
                    </span>
                    <span className="fig">{num(seconds / 3600, 1)} h</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="chart-note">{zoneNote(zones.data)}</p>
          </>
        )}
      </section>

      <div className="pair">
        <section className="band">
          <div className="band-head">
            <h2 className="band-title">Threshold power</h2>
            {ftpNow != null && (
              <span className="card-note">
                <span className="fig">{watts(ftpNow)}</span> W now
                {ftpThen != null && ftpThen !== ftpNow && (
                  <>
                    {' · '}
                    <span className={ftpNow < ftpThen ? 'bad' : 'good'}>
                      {signed(ftpNow - ftpThen)}
                    </span>{' '}
                    over this range
                  </>
                )}
              </span>
            )}
          </div>
          <p className="band-desc">
            Garmin’s own estimate, as it stood on each ride. It steps up after a hard effort and
            drifts down when none is recorded, so a fall here is not always lost form.
          </p>
          {ftp.state === 'error' && <p className="state state-error">{ftp.message}</p>}
          {ftp.state === 'loading' && (
            <div className="skeleton skeleton-plot" style={{ height: 180 }} />
          )}
          {ftp.state === 'ready' &&
            (ftpByDay.some((w) => w != null) ? (
              <LineChart
                labels={rows.map((r) => (wide ? monthYear(r.local_date) : shortDate(r.local_date)))}
                height={180}
                yUnit="watts"
                series={[{ name: 'FTP', colour: 'var(--chart-1)', width: 2, values: ftpByDay }]}
              />
            ) : (
              <p className="state">No powered ride in this range, so no estimate to draw.</p>
            ))}
        </section>

        <section className="band">
          <h2 className="band-title">Best power by season</h2>
          <p className="band-desc">
            This year against the same months of last year, from the original ride files. Only
            rides with a power meter are in it.
          </p>
          {powerBySeason.length === 0 ? (
            <p className="state">
              No ride files parsed yet. Run <code>npm run sync:fit</code> to download them.
            </p>
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
                    <td>{durationLabel(p.duration)}</td>
                    <td className="num fig">
                      {p.now == null ? <span className="dash">{DASH}</span> : watts(p.now)}
                    </td>
                    <td className="num fig">
                      {p.before == null ? <span className="dash">{DASH}</span> : watts(p.before)}
                    </td>
                    <td className="num fig">
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
        </section>
      </div>

      <div className="pair">
        <section className="band">
          <h2 className="band-title">Rides by type</h2>
          <p className="band-desc">
            All time, as a share of every ride. Mountain biking is most of the riding and none
            of it carries a power meter.
          </p>
          {typeRows.length === 0 ? (
            <p className="state">No rides imported yet.</p>
          ) : (
            <div className="share">
              {typeRows.map((t) => (
                <div className="share-row" key={t.activity_type}>
                  <div
                    className="share-fill"
                    style={{ width: `${(t.n / Math.max(1, typeTotal)) * 100}%` }}
                  />
                  <span className="share-label">{typeName(t.activity_type)}</span>
                  <span className="share-figures">
                    <span className="share-pct fig">{pct(t.n, typeTotal)}</span>
                    <span className="fig">{num(t.n)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="band">
          <h2 className="band-title">Rides the model cannot trust</h2>
          <p className="band-desc">
            No training load at all, or no heart-rate strap on a ride over ten minutes, as a
            share of each type’s own rides.
          </p>
          {typeRows.length === 0 ? (
            <p className="state">No rides imported yet.</p>
          ) : (
            <div className="share">
              {typeRows.map((t) => {
                const bad = t.no_load + t.no_strap;
                return (
                  <div className="share-row" key={t.activity_type}>
                    <div
                      className="share-fill"
                      style={{ width: `${(bad / Math.max(1, t.n)) * 100}%` }}
                    />
                    <span className="share-label">{typeName(t.activity_type)}</span>
                    <span className="share-figures">
                      <span className="share-pct fig">{pct(bad, t.n)}</span>
                      <span className="fig">{num(bad)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="pair">
        <section className="band">
          <h2 className="band-title">Season by season</h2>
          <p className="band-desc">
            Each year counted only as far into it as today, so this one is not measured against
            twelve months of the last.
          </p>
          {seasons.state === 'error' && <p className="state state-error">{seasons.message}</p>}
          {seasons.state === 'ready' && seasonRows.length === 0 ? (
            <p className="state">No rides imported yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Rides</th>
                  <th className="num">Hours</th>
                  <th className="num">km</th>
                  <th className="num">Climb m</th>
                </tr>
              </thead>
              <tbody>
                {seasonRows.map((s) => (
                  <tr key={s.year}>
                    <td className="fig">{s.year}</td>
                    <td className="num fig">{num(s.rides)}</td>
                    <td className="num fig">{num(s.hours, 0)}</td>
                    <td className="num fig">{num(s.km, 0)}</td>
                    <td className="num fig">{num(s.elevation_m, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="band">
          <h2 className="band-title">Biggest weeks</h2>
          <p className="band-desc">The six heaviest weeks in this range, by Garmin ride time.</p>
          {weeks.state === 'error' && <p className="state state-error">{weeks.message}</p>}
          {biggest.length === 0 ? (
            <p className="state">No weeks in this range.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Week of</th>
                  <th className="num">Rides</th>
                  <th className="num">Hours</th>
                  <th className="num">Load</th>
                </tr>
              </thead>
              <tbody>
                {biggest.map((w) => (
                  <tr key={w.week}>
                    <td className="fig">{longDate(w.week_start)}</td>
                    <td className="num fig">{num(w.rides)}</td>
                    <td className="num fig">{num(w.hours, 1)}</td>
                    <td className="num fig">{num(w.load_points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

/** The six durations a rider actually talks about. */
const PEAK_DURATIONS = [5, 60, 300, 600, 1200, 3600];

/**
 * The two things a share table cannot say for itself: how much of the riding the buckets
 * actually cover, and whether the shape has moved. The comparison span is the one of equal
 * length immediately before it, the way the season tables are held against each other.
 */
function zoneNote({ period, previous }: ZoneReading): React.ReactNode {
  const hardShare = (t: ZoneTotals) =>
    t.zoneSeconds > 0 ? ((t.seconds[3] ?? 0) + (t.seconds[4] ?? 0)) / t.zoneSeconds : null;
  const now = hardShare(period);
  const then = hardShare(previous);

  return (
    <>
      Shares of recorded time, not of the ride: the buckets cover{' '}
      <span className="fig">{period.coverage == null ? DASH : pct(period.coverage, 1)}</span> of
      ride time in this period, and paused or strapless time falls into none of them.
      {now != null && then != null && previous.rides > 0 && (
        <>
          {' '}
          Zones 4 and 5 together were <span className="fig">{pct(then, 1)}</span> of the span
          before this one and <span className="fig">{pct(now, 1)}</span> of this one. Compare the
          shares and not the hours: that span carried zones on{' '}
          <span className="fig">{num(previous.rides)}</span> of its{' '}
          <span className="fig">{num(previous.ridesTotal)}</span> rides against{' '}
          <span className="fig">{num(period.rides)}</span> of{' '}
          <span className="fig">{num(period.ridesTotal)}</span> here, so the time behind the two
          is not the same quantity.
        </>
      )}{' '}
      The bpm boundaries behind the zones sit in the Garmin profile and are not read yet.
    </>
  );
}

function peakAt(curve: Async<{ rows: PowerPoint[] }>, duration: number): number | null {
  if (curve.state !== 'ready') return null;
  return curve.data.rows.find((r) => r.duration_s === duration)?.watts ?? null;
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value fig">{value}</div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}
