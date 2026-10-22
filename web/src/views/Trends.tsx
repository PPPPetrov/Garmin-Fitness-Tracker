import { useState } from 'react';
import { useApi, type LoadDay, type PowerPoint, type RideType, type Week } from '../api';
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

  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${from}`, [range.id]);
  const weeks = useApi<{ rows: Week[] }>(`/api/weeks?from=${from}`, [range.id]);
  const types = useApi<{ rows: RideType[] }>('/api/types');
  const power = useApi<{ rows: PowerPoint[] }>('/api/power-curve');

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
  const bests = power.state === 'ready' ? pickDurations(power.data.rows) : [];
  const typeRows = types.state === 'ready' ? types.data.rows : [];
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
              : `Training load over ${range.label.toLowerCase()}, and the best power held at each duration. Load covers every ride; power covers only the rides with a power meter.`}
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
          <h2 className="band-title">Best power held</h2>
          <p className="band-desc">
            All time, taken from the original ride files rather than Garmin’s summary.
          </p>
          {power.state === 'error' && <p className="state state-error">{power.message}</p>}
          {power.state === 'ready' && bests.length === 0 ? (
            <p className="state">
              No ride files parsed yet. Run <code>npm run sync:fit</code> to download them.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Duration</th>
                  <th className="num">Watts</th>
                  <th className="num">Set on</th>
                </tr>
              </thead>
              <tbody>
                {bests.map((p) => (
                  <tr key={p.duration_s}>
                    <td>{durationLabel(p.duration_s)}</td>
                    <td className="num fig">{watts(p.watts)}</td>
                    <td className="num fig">{p.local_date}</td>
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

function pickDurations(rows: PowerPoint[]): PowerPoint[] {
  const wanted = [5, 60, 300, 600, 1200, 3600];
  return wanted
    .map((d) => rows.find((r) => r.duration_s === d))
    .filter((r): r is PowerPoint => r != null);
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
