import { useState } from 'react';
import {
  useApi,
  type LoadDay,
  type RideType,
  type Season,
  type Week,
  type ZoneReading,
  type ZoneTotals,
} from '../api';
import { LineChart, LineLegend } from '../charts/Line';
import {
  DASH,
  isoDaysAgo,
  longDate,
  monthYear,
  num,
  pct,
  shortDate,
  signed,
  typeName,
} from '../format';
import { Card } from '../ui';

const RANGES = [
  { id: '12w', label: '12 weeks', phrase: 'the last 12 weeks', days: 84 },
  { id: '1y', label: '1 year', phrase: 'the last year', days: 365 },
  { id: 'all', label: 'All', phrase: 'the whole history', days: 3000 },
] as const;

/* As tall as the two share cards stacked beside it, so the row ends on one line with no
   empty space under the chart. */
const FORM_PLOT_HEIGHT = 480;

/** One hue, laddered from easy to hard: the zones are ordered, so their colour is too. */
const ZONE_FILL = [
  'var(--accent-200)',
  'var(--accent-300)',
  'var(--chart-1)',
  'var(--accent)',
  'var(--accent-ink)',
];

/** The screen's question: how has the load moved over this period? */
export function Trends() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const from = isoDaysAgo(range.days);

  const load = useApi<{ rows: LoadDay[] }>(`/api/load?from=${from}`, [range.id]);
  const weeks = useApi<{ rows: Week[] }>(`/api/weeks?from=${from}`, [range.id]);
  const types = useApi<{ rows: RideType[] }>('/api/types');
  const seasons = useApi<{ rows: Season[] }>('/api/seasons');
  const zones = useApi<ZoneReading>(`/api/zones?from=${from}`, [range.id]);

  const rows = load.state === 'ready' ? load.data.rows : [];
  const wide = range.days > 200;
  const axisLabels = rows.map((r) => (wide ? monthYear(r.local_date) : shortDate(r.local_date)));
  const tipLabels = rows.map((r) => longDate(r.local_date));

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

  const biggest = [...weekRows].sort((a, b) => b.hours - a.hours).slice(0, 5);
  const typeRows = types.state === 'ready' ? types.data.rows : [];

  const seasonRows = seasons.state === 'ready' ? seasons.data.rows : [];
  /* The bar and the percentage beside it are the same number, so a row can never say
     two things: here the share of all rides, below the share of that type's own rides. */
  const typeTotal = typeRows.reduce((sum, t) => sum + t.n, 0);

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Trends</h1>
          <p className="subtitle">
            {rows.length === 0
              ? 'No days in this range yet.'
              : `Training load over ${range.phrase}.`}
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

      <div className="stack">
        <div className="grid grid-6">
          <Figure
            label="Fitness"
            value={latest ? num(latest.fitness) : DASH}
            note="42-day average"
          />
          <Figure
            label="Fatigue"
            value={latest ? num(latest.fatigue) : DASH}
            note="7-day average"
          />
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

        <div className="grid grid-2-1">
          <Card
            title="Training load"
            info="Fitness is the 42-day weighted average of daily training load; fatigue is the 7-day one, so it rises and falls first."
            aside={
              <LineLegend
                series={[
                  { name: 'Fitness', colour: 'var(--chart-1)' },
                  { name: 'Fatigue', colour: 'var(--chart-2)' },
                ]}
              />
            }
          >
            {load.state === 'loading' && (
              <div className="skeleton skeleton-plot" style={{ height: 250 }} />
            )}
            {load.state === 'error' && <p className="state state-error">{load.message}</p>}
            {load.state === 'ready' && rows.length === 0 && (
              <p className="state">No days in this range.</p>
            )}
            {load.state === 'ready' && rows.length > 0 && (
              <>
                <LineChart
                  labels={axisLabels}
                  tipLabels={tipLabels}
                  height={250}
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
                  {estimated > 0 ? (
                    <>
                      <span className="fig">{num(estimated)}</span> of{' '}
                      <span className="fig">{num(rows.length)}</span> days sit within 42 days of a
                      ride whose load is missing or was recorded without a heart-rate strap, so the
                      curve runs below the real work on them.
                    </>
                  ) : (
                    'Every ride in this range carried a usable training load.'
                  )}
                </p>
              </>
            )}
          </Card>

          <Card
            title="Time in heart-rate zone"
            info={
              <>
                What kind of riding this was, rather than how much: the only intensity figures that
                reach the mountain biking, which has no power meter. Shares are of recorded time,
                not of the ride; paused or strapless time falls into no zone. The bpm boundaries sit
                in the Garmin profile and are not read yet.
              </>
            }
            aside={
              zones.state === 'ready' &&
              zones.data.period.rides > 0 && (
                <span>
                  <span className="fig">{num(zones.data.period.rides)}</span> of{' '}
                  <span className="fig">{num(zones.data.period.ridesTotal)}</span> rides
                </span>
              )
            }
          >
            {zones.state === 'error' && <p className="state state-error">{zones.message}</p>}
            {zones.state === 'loading' && (
              <div className="skeleton skeleton-plot" style={{ height: 240 }} />
            )}
            {zones.state === 'ready' && zones.data.period.rides === 0 && (
              <p className="state">
                No ride in this period carries zone data. Garmin began reporting the buckets partway
                through the history, and nothing before 2024 has them.
              </p>
            )}
            {zones.state === 'ready' && zones.data.period.rides > 0 && (
              <>
                <div className="bars">
                  {zones.data.period.seconds.map((seconds, i) => (
                    <div key={i}>
                      <div className="bar-row-head">
                        <span className="bar-row-label">Zone {i + 1}</span>
                        <span className="bar-row-figures">
                          <span className="share">
                            {pct(seconds, zones.data.period.zoneSeconds)}
                          </span>
                          <b>{num(seconds / 3600, 1)} h</b>
                        </span>
                      </div>
                      <div className="track">
                        <div
                          className="track-fill"
                          style={{
                            width: `${(seconds / Math.max(1, zones.data.period.zoneSeconds)) * 100}%`,
                            background: ZONE_FILL[i],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="note">{zoneNote(zones.data)}</p>
              </>
            )}
          </Card>
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Form"
            info="Fitness minus fatigue, lagged a day. Above the dashed line you are fresh; below it you are carrying the week's work."
          >
            {load.state === 'loading' && (
              <div className="skeleton skeleton-plot" style={{ height: FORM_PLOT_HEIGHT }} />
            )}
            {load.state === 'ready' && rows.length > 0 && (
              <LineChart
                labels={axisLabels}
                tipLabels={tipLabels}
                height={FORM_PLOT_HEIGHT}
                yUnit="points"
                reference={{ value: 0 }}
                format={(v) => signed(Math.round(v))}
                series={[
                  {
                    name: 'Form',
                    colour: 'var(--chart-1)',
                    width: 2,
                    values: rows.map((r) => r.form),
                  },
                ]}
              />
            )}
          </Card>

          <div className="column">
            <Card
              title="Rides by type"
              info="All time, as a share of every ride. Mountain biking is most of the riding and none of it carries a power meter."
              aside="All time"
            >
              {typeRows.length === 0 ? (
                <p className="state">No rides imported yet.</p>
              ) : (
                <div className="bars">
                  {typeRows.map((t) => (
                    <ShareBar
                      key={t.activity_type}
                      label={typeName(t.activity_type)}
                      share={t.n / Math.max(1, typeTotal)}
                      shareText={pct(t.n, typeTotal)}
                      figure={num(t.n)}
                    />
                  ))}
                </div>
              )}
            </Card>
  
            <Card
              title="Rides the model cannot trust"
              info="No training load at all, or no heart-rate strap on a ride over ten minutes, as a share of each type's own rides."
            >
              {typeRows.length === 0 ? (
                <p className="state">No rides imported yet.</p>
              ) : (
                <div className="bars">
                  {typeRows.map((t) => {
                    const bad = t.no_load + t.no_strap;
                    return (
                      <ShareBar
                        key={t.activity_type}
                        label={typeName(t.activity_type)}
                        share={bad / Math.max(1, t.n)}
                        shareText={pct(bad, t.n)}
                        figure={num(bad)}
                        muted
                      />
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="grid grid-1-1">
          <Card
            title="Season by season"
            info="Each year counted only as far into it as today, so this one is not measured against twelve months of the last."
            aside="To this date in each year"
            flush
          >
            {seasons.state === 'error' && (
              <p className="state state-error" style={{ margin: 16 }}>
                {seasons.message}
              </p>
            )}
            {seasons.state === 'ready' && seasonRows.length === 0 ? (
              <p className="state" style={{ margin: 16 }}>
                No rides imported yet.
              </p>
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
                      <td className="fig" style={{ fontWeight: 500 }}>
                        {s.year}
                      </td>
                      <td className="num">{num(s.rides)}</td>
                      <td className="num">{num(s.hours, 0)}</td>
                      <td className="num">{num(s.km, 0)}</td>
                      <td className="num">{num(s.elevation_m, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title="Biggest weeks"
            info="The heaviest weeks in this range, by Garmin ride time."
            aside={
              range.id === 'all' ? 'All time' : range.id === '1y' ? 'Last year' : 'Last 12 weeks'
            }
            flush
          >
            {weeks.state === 'error' && (
              <p className="state state-error" style={{ margin: 16 }}>
                {weeks.message}
              </p>
            )}
            {biggest.length === 0 ? (
              <p className="state" style={{ margin: 16 }}>
                No weeks in this range.
              </p>
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
                      <td className="fig" style={{ fontWeight: 500 }}>
                        {longDate(w.week_start)}
                      </td>
                      <td className="num">{num(w.rides)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {num(w.hours, 1)}
                      </td>
                      <td className="num">{num(w.load_points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

      </div>
    </>
  );
}

/**
 * Whether the shape has moved, against the span of equal length immediately before this
 * one. Compared as shares, not hours: the two spans carry zones on different numbers of
 * rides, so the time behind them is not the same quantity.
 */
function zoneNote({ period, previous }: ZoneReading): React.ReactNode {
  const hardShare = (t: ZoneTotals) =>
    t.zoneSeconds > 0 ? ((t.seconds[3] ?? 0) + (t.seconds[4] ?? 0)) / t.zoneSeconds : null;
  const now = hardShare(period);
  const then = hardShare(previous);

  return (
    <>
      The zones cover{' '}
      <span className="fig">{period.coverage == null ? DASH : pct(period.coverage, 1)}</span> of
      ride time here.
      {now != null && then != null && previous.rides > 0 && (
        <>
          {' '}
          Zones 4 and 5 were <span className="fig">{pct(now, 1)}</span> of it, against{' '}
          <span className="fig">{pct(then, 1)}</span> in the span before.
        </>
      )}
    </>
  );
}

function ShareBar({
  label,
  share,
  shareText,
  figure,
  muted,
}: {
  label: string;
  share: number;
  shareText: string;
  figure: string;
  /** A share that is a problem, not a quantity: drawn in grey so it does not read as data won. */
  muted?: boolean;
}) {
  return (
    <div>
      <div className="bar-row-head">
        <span className="bar-row-label">{label}</span>
        <span className="bar-row-figures">
          <span className="share">{shareText}</span>
          <b>{figure}</b>
        </span>
      </div>
      <div className="track">
        <div
          className="track-fill"
          style={{
            width: `${share * 100}%`,
            background: muted ? 'var(--muted)' : undefined,
          }}
        />
      </div>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card title={label}>
      <div className="figure figure-sm">{value}</div>
      <div className="caption">{note}</div>
    </Card>
  );
}
