import { useState } from 'react';
import { useApi, type Activity } from '../api';
import { DASH, duration, km, num, typeName, watts } from '../format';

interface Page {
  total: number;
  limit: number;
  offset: number;
  rows: Activity[];
}

interface Types {
  rows: { activity_type: string; n: number; powered: number }[];
}

const PAGE = 50;

export function Activities() {
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (type) query.set('type', type);
  if (search) query.set('search', search);

  const page = useApi<Page>(`/api/activities?${query}`, [type, search, offset]);
  const types = useApi<Types>('/api/types');

  const change = (next: () => void) => {
    setOffset(0);
    next();
  };

  return (
    <>
      <div className="title-row">
        <h1>Activities</h1>
      </div>
      <p className="finding">
        Every ride imported from Garmin. A dash means the sensor was not there, not a zero.
      </p>

      <div className="filters">
        <select
          className="field"
          value={type}
          aria-label="Activity type"
          onChange={(e) => change(() => setType(e.target.value))}
        >
          <option value="">All types</option>
          {types.state === 'ready' &&
            types.data.rows.map((t) => (
              <option key={t.activity_type} value={t.activity_type}>
                {typeName(t.activity_type)} ({t.n}, {t.powered} with power)
              </option>
            ))}
        </select>
        <input
          className="field"
          type="search"
          placeholder="Search name or place"
          value={search}
          aria-label="Search rides"
          onChange={(e) => change(() => setSearch(e.target.value))}
        />
        {page.state === 'ready' && (
          <span className="sub">
            {num(page.data.total)} ride{page.data.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {page.state === 'loading' && <p className="state">Loading…</p>}
      {page.state === 'error' && <p className="state state-error">{page.message}</p>}

      {page.state === 'ready' && page.data.total === 0 && (
        <p className="state">No rides match these filters.</p>
      )}

      {page.state === 'ready' && page.data.total > 0 && (
        <>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ride</th>
                  <th>Type</th>
                  <th className="num">Time</th>
                  <th className="num">km</th>
                  <th className="num">Climb m</th>
                  <th className="num">Avg W</th>
                  <th className="num">NP</th>
                  <th className="num">FTP</th>
                  <th className="num">TSS</th>
                  <th className="num">Load</th>
                  <th className="num">Avg HR</th>
                </tr>
              </thead>
              <tbody>
                {page.data.rows.map((a) => (
                  <tr key={a.activity_id}>
                    <td>{a.local_date}</td>
                    <td>
                      {a.activity_name ?? DASH}
                      {a.location_name && <div className="sub">{a.location_name}</div>}
                    </td>
                    <td>{typeName(a.activity_type)}</td>
                    <td className="num">{duration(a.duration_s)}</td>
                    <td className="num">{km(a.distance_m)}</td>
                    <td className="num">
                      <Cell value={a.elevation_gain_m} />
                    </td>
                    <td className="num">
                      <Cell value={a.avg_power} format={watts} />
                    </td>
                    <td className="num">
                      <Cell value={a.normalized_power} format={watts} />
                    </td>
                    <td className="num">
                      <Cell value={a.ftp_at_ride} format={watts} />
                    </td>
                    <td className="num">
                      <Cell value={a.training_stress_score} format={(v) => num(v, 0)} />
                    </td>
                    <td className="num">
                      <Cell value={a.activity_training_load} format={(v) => num(v, 0)} />
                    </td>
                    <td className="num">
                      <Cell value={a.avg_hr} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="filters" style={{ marginTop: 16 }}>
            <button
              className="btn-quiet"
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Previous
            </button>
            <button
              className="btn-quiet"
              type="button"
              disabled={offset + PAGE >= page.data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Next
            </button>
            <span className="sub">
              {offset + 1}–{Math.min(offset + PAGE, page.data.total)} of {num(page.data.total)}
            </span>
          </div>
        </>
      )}
    </>
  );
}

function Cell({
  value,
  format = (v: number) => num(v),
}: {
  value: number | null;
  format?: (v: number) => string;
}) {
  if (value == null) return <span className="dash">{DASH}</span>;
  return <>{format(value)}</>;
}
