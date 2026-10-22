import { useEffect, useState } from 'react';
import { startSync, useApi, type Status } from './api';
import { num } from './format';
import { Activities } from './views/Activities';
import { Overview } from './views/Overview';
import { Trends } from './views/Trends';

const VIEWS = [
  { id: 'overview', label: 'Overview', render: () => <Overview /> },
  { id: 'trends', label: 'Trends', render: () => <Trends /> },
  { id: 'activities', label: 'Activities', render: () => <Activities /> },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

function currentView(): ViewId {
  const hash = window.location.hash.replace('#', '');
  return VIEWS.some((v) => v.id === hash) ? (hash as ViewId) : 'overview';
}

export function App() {
  const [view, setView] = useState<ViewId>(currentView);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const status = useApi<Status>('/api/status', [syncNote]);

  useEffect(() => {
    const onHashChange = () => setView(currentView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const response = await startSync();
      setSyncNote(
        response.ok ? 'Sync started. Reload in a minute to see new rides.' : 'A sync is already running.',
      );
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : 'Sync could not be started.');
    } finally {
      setSyncing(false);
    }
  }

  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const coverage = status.state === 'ready' ? status.data.coverage : null;
  const fields = status.state === 'ready' ? status.data.fieldCoverage : null;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-name">Fitness Tracker</div>
          <div className="brand-sub">
            {coverage?.start ? `${coverage.start} – ${coverage.end}` : 'No rides yet'}
          </div>
        </div>

        {VIEWS.map((v) => (
          <a
            key={v.id}
            className="nav-item"
            href={`#${v.id}`}
            aria-current={v.id === view ? 'page' : undefined}
          >
            {v.label}
            {v.id === 'activities' && coverage && (
              <span className="nav-count">{num(coverage.total)}</span>
            )}
          </a>
        ))}

        <div className="nav-group-label">Data</div>
        <button className="nav-item" type="button" onClick={sync} disabled={syncing}>
          {syncing ? 'Starting…' : 'Sync now'}
        </button>

        <div className="sidebar-foot">
          {fields && (
            <>
              {num(fields.total)} rides. {num(fields.withTss)} have power,{' '}
              {num(fields.total - fields.unreliableLoad)} have a trustworthy training load.
              <br />
            </>
          )}
          {syncNote && <span>{syncNote}</span>}
        </div>
      </nav>

      <main className="canvas">{active.render()}</main>
    </div>
  );
}
