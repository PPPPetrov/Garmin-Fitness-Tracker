import { useState } from 'react';
import { useApi, type LoadDay, type PowerPoint } from '../api';
import { LineChart } from '../charts/Line';
import { durationLabel, monthYear, num, shortDate, watts } from '../format';

const RANGES = [
  { id: '12w', label: '12 weeks', days: 84 },
  { id: '1y', label: '1 year', days: 365 },
  { id: '4y', label: 'All', days: 3000 },
] as const;

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function Trends() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${iso(range.days)}`, [range.id]);
  const power = useApi<{ rows: PowerPoint[] }>('/api/power-curve');

  return (
    <>
      <div className="title-row">
        <h1>Trends</h1>
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
      <p className="finding">
        Training load over time, and the best power held at each duration. Load covers every ride;
        power covers only the rides with a power meter.
      </p>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            Training load <span className="section-note">in points</span>
          </h2>
          <div className="legend">
            <span>
              <i style={{ background: 'var(--chart-hue)' }} /> Fitness
            </span>
            <span>
              <i style={{ background: 'var(--chart-grey)' }} /> Fatigue
            </span>
          </div>
        </div>
        <div className="card">
          {load.state === 'loading' && <p className="sub">Loading…</p>}
          {load.state === 'error' && <p className="state-error">{load.message}</p>}
          {load.state === 'ready' && <LoadPlot rows={load.data.rows} wide={range.days > 200} />}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Form</h2>
          <span className="section-note">Fitness minus fatigue. Above the line is fresh.</span>
        </div>
        <div className="card">
          {load.state === 'ready' && (
            <LineChart
              labels={load.data.rows.map((r) =>
                range.days > 200 ? monthYear(r.local_date) : shortDate(r.local_date),
              )}
              height={168}
              yUnit="points"
              reference={{ value: 0, label: 'neutral' }}
              series={[
                {
                  name: 'Form',
                  colour: 'var(--chart-ink)',
                  width: 1.5,
                  values: load.data.rows.map((r) => r.form),
                },
              ]}
            />
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Best power held</h2>
          <span className="section-note">All time, from the original ride files</span>
        </div>
        <div className="card table-scroll">
          {power.state === 'loading' && <p className="sub">Loading…</p>}
          {power.state === 'error' && <p className="state-error">{power.message}</p>}
          {power.state === 'ready' && power.data.rows.length === 0 && (
            <p className="sub">
              No ride files parsed yet. Run <code>npm run sync:fit</code> to download them.
            </p>
          )}
          {power.state === 'ready' && power.data.rows.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Duration</th>
                  <th className="num">Watts</th>
                  <th>Set on</th>
                </tr>
              </thead>
              <tbody>
                {power.data.rows.map((p) => (
                  <tr key={p.duration_s}>
                    <td>{durationLabel(p.duration_s)}</td>
                    <td className="num">{watts(p.watts)}</td>
                    <td>{p.local_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

function LoadPlot({ rows, wide }: { rows: LoadDay[]; wide: boolean }) {
  if (rows.length === 0) return <p className="sub">No data in this range.</p>;

  const estimated = rows.filter((r) => r.is_estimated === 1).length;

  return (
    <>
      <LineChart
        labels={rows.map((r) => (wide ? monthYear(r.local_date) : shortDate(r.local_date)))}
        height={248}
        yUnit="points"
        series={[
          {
            name: 'Fitness',
            colour: 'var(--chart-hue)',
            width: 2,
            values: rows.map((r) => r.fitness),
          },
          {
            name: 'Fatigue',
            colour: 'var(--chart-grey)',
            width: 1.5,
            values: rows.map((r) => r.fatigue),
          },
        ]}
      />
      <p className="sub" style={{ marginBottom: 0 }}>
        {estimated > 0 ? (
          <>
            {num(estimated)} of {num(rows.length)} days in this range sit within 42 days of a ride
            whose training load is missing or was recorded without a heart-rate strap, so the curve
            runs below the real work there.
          </>
        ) : (
          'Every ride in this range carried a usable training load.'
        )}
      </p>
    </>
  );
}
