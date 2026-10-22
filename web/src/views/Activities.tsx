import { useState } from 'react';
import { useApi, type Activity, type RideType } from '../api';
import { DASH, duration, km, num, rideName, typeName, watts } from '../format';

interface Page {
  total: number;
  limit: number;
  offset: number;
  rows: Activity[];
}

const PAGE = 50;

/**
 * The same test the load model uses, so a row flagged here is a row the curve discounts:
 * no training load at all, or no heart-rate strap on a ride long enough to matter.
 */
function unusableLoad(a: Activity): string | null {
  if (a.activity_training_load == null) return 'no training load';
  if (a.avg_hr == null && (a.duration_s ?? 0) > 600) return 'no heart-rate strap';
  return null;
}

/** The screen's question: find the ride I am thinking of. */
export function Activities() {
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (type) query.set('type', type);
  if (search) query.set('search', search);

  const page = useApi<Page>(`/api/activities?${query}`, [type, search, offset]);
  const types = useApi<{ rows: RideType[] }>('/api/types');

  const change = (next: () => void) => {
    setOffset(0);
    next();
  };

  const total = page.state === 'ready' ? page.data.total : null;
  const filtered = Boolean(type || search);

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Activities</h1>
          <p className="finding">
            Every ride imported from Garmin, newest first. A dash means the sensor was not
            there. It is never a zero, and the ride is never dropped.
          </p>
        </div>
      </div>

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
                {typeName(t.activity_type)} ({t.n})
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
        <span className="sub">
          {total == null ? (
            'Counting…'
          ) : (
            <>
              <span className="fig">{num(total)}</span> ride{total === 1 ? '' : 's'}
              {filtered ? ' match these filters' : ''}
            </>
          )}
        </span>
      </div>

      {page.state === 'error' && (
        <p className="state state-error">Could not load the rides: {page.message}</p>
      )}

      {page.state === 'ready' && page.data.total === 0 && (
        <p className="state">
          No rides match these filters. Clear the search or choose another type.
        </p>
      )}

      {(page.state === 'loading' || (page.state === 'ready' && page.data.total > 0)) && (
        <>
          <div className="table-scroll">
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
                {page.state === 'loading' &&
                  Array.from({ length: 12 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={12}>
                        <div className="skeleton skeleton-row" style={{ width: '100%' }} />
                      </td>
                    </tr>
                  ))}

                {page.state === 'ready' &&
                  page.data.rows.map((a) => {
                    const flag = unusableLoad(a);
                    return (
                      <tr key={a.activity_id}>
                        <td className="fig">{a.local_date}</td>
                        <td className="name">
                          <div className="row-name">{rideName(a.activity_name, DASH)}</div>
                          {(a.location_name || flag) && (
                            <div className="sub">
                              {[a.location_name, flag].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td>{typeName(a.activity_type)}</td>
                        <td className="num fig">{duration(a.duration_s)}</td>
                        <td className="num fig">{km(a.distance_m)}</td>
                        <td className="num fig">
                          <Cell value={a.elevation_gain_m} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.avg_power} format={watts} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.normalized_power} format={watts} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.ftp_at_ride} format={watts} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.training_stress_score} format={(v) => num(v, 0)} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.activity_training_load} format={(v) => num(v, 0)} />
                        </td>
                        <td className="num fig">
                          <Cell value={a.avg_hr} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {page.state === 'ready' && (
            <div className="filters" style={{ marginTop: 16, marginBottom: 0 }}>
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
              <span className="sub fig">
                {offset + 1}–{Math.min(offset + PAGE, page.data.total)} of {num(page.data.total)}
              </span>
            </div>
          )}
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
