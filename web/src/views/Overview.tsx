import { useApi, type Activity, type LoadDay, type Week } from '../api';
import { BarChart } from '../charts/Bars';
import { LineChart } from '../charts/Line';
import { DASH, duration, km, num, shortDate, signed, typeName, watts } from '../format';

interface OverviewData {
  today: LoadDay | null;
  weeks: Week[];
  recent: Activity[];
}

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function Overview() {
  const overview = useApi<OverviewData>('/api/overview');
  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${iso(365)}`);

  if (overview.state === 'loading' || load.state === 'loading') {
    return <p className="state">Loading…</p>;
  }
  if (overview.state === 'error') {
    return <p className="state state-error">Could not load the overview: {overview.message}</p>;
  }
  if (load.state === 'error') {
    return <p className="state state-error">Could not load the curve: {load.message}</p>;
  }

  const { today, weeks, recent } = overview.data;
  const rows = load.data.rows;

  // The finding: where fitness stands against twelve weeks ago, measured on the curve itself.
  const twelveWeeksAgo = rows.find((r) => r.local_date >= iso(84));
  const change = today && twelveWeeksAgo ? today.fitness - twelveWeeksAgo.fitness : null;
  const unmeasuredDays = rows.filter((r) => r.unmeasured_rides > 0).length;

  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];

  return (
    <>
      <div className="title-row">
        <h1>Overview</h1>
      </div>

      <p className="finding">
        {today == null ? (
          'No rides imported yet.'
        ) : (
          <>
            Fitness is <strong>{num(today.fitness)} points</strong>
            {change != null && (
              <>
                , {signed(change)} against twelve weeks ago ({num(twelveWeeksAgo?.fitness ?? 0)})
              </>
            )}
            . Form is <strong>{signed(today.form)}</strong>, so you are carrying{' '}
            {today.form > 15 ? 'little' : today.form > -10 ? 'moderate' : 'heavy'} fatigue into
            today.
            {unmeasuredDays > 0 && (
              <>
                {' '}
                {unmeasuredDays} day{unmeasuredDays === 1 ? '' : 's'} in the last year had a ride
                with no usable training load — no value, or no heart-rate strap — so the curve runs
                below the real work there.
              </>
            )}
          </>
        )}
      </p>

      <section className="section">
        <div className="kpi-strip">
          <Kpi
            label="Fitness"
            value={today ? num(today.fitness) : DASH}
            note="42-day average load"
          />
          <Kpi label="Fatigue" value={today ? num(today.fatigue) : DASH} note="7-day average load" />
          <Kpi
            label="Form"
            value={today ? signed(today.form) : DASH}
            note="fitness minus fatigue"
          />
          <Kpi
            label="This week"
            value={thisWeek ? num(thisWeek.hours, 1) : DASH}
            unit="h"
            note={
              thisWeek && lastWeek
                ? `${signed(thisWeek.hours - lastWeek.hours, 1)} h on last week`
                : 'no comparison yet'
            }
          />
          <Kpi
            label="Rides this week"
            value={thisWeek ? num(thisWeek.rides) : DASH}
            note={thisWeek ? `${num(thisWeek.km, 0)} km, ${num(thisWeek.elevation_m)} m climbed` : ''}
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            Fitness and fatigue, last 12 months{' '}
            <span className="section-note">in training-load points</span>
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
          <LineChart
            labels={rows.map((r) => shortDate(r.local_date))}
            height={236}
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
            Garmin training-load points. Estimated from heart rate and power by Garmin, not a
            measurement of recovery.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            Weekly hours, last 26 weeks{' '}
            <span className="section-note">Garmin ride time, not moving time</span>
          </h2>
        </div>
        <div className="card">
          <BarChart
            labels={weeks.map((w) => shortDate(w.week_start))}
            values={weeks.map((w) => w.hours)}
            yUnit="hours"
            height={180}
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Recent rides</h2>
          <a className="section-note" href="#activities">
            View all
          </a>
        </div>
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Ride</th>
                <th>Type</th>
                <th className="num">Time</th>
                <th className="num">km</th>
                <th className="num">Climb</th>
                <th className="num">Avg W</th>
                <th className="num">Load</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.activity_id}>
                  <td>{shortDate(a.local_date)}</td>
                  <td>{a.activity_name ?? DASH}</td>
                  <td>{typeName(a.activity_type)}</td>
                  <td className="num">{duration(a.duration_s)}</td>
                  <td className="num">{km(a.distance_m)}</td>
                  <td className="num">
                    {a.elevation_gain_m == null ? (
                      <span className="dash">{DASH}</span>
                    ) : (
                      num(a.elevation_gain_m)
                    )}
                  </td>
                  <td className="num">
                    {a.avg_power == null ? (
                      <span className="dash">{DASH}</span>
                    ) : (
                      watts(a.avg_power)
                    )}
                  </td>
                  <td className="num">
                    {a.activity_training_load == null ? (
                      <span className="dash">{DASH}</span>
                    ) : (
                      num(a.activity_training_load)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}
