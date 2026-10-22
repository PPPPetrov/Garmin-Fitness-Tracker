import { useEffect, useState } from 'react';
import { startSync, useApi, type Status } from './api';
import { longDate, num, stamp } from './format';
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

/** The mark: the fitness curve itself, rising to a point. Not a square with a letter. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path
        d="M2.5 16.5 L7 11.5 L11 13.5 L19 4.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="4.5" r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function NavIcon({ id }: { id: ViewId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'overview') {
    return (
      <svg {...common}>
        <path d="M1.5 11 L5 6.5 L8 8.5 L14.5 2.5" />
        <path d="M1.5 14.5 h13" />
      </svg>
    );
  }
  if (id === 'trends') {
    return (
      <svg {...common}>
        <path d="M2.5 13.5 V8" />
        <path d="M6.5 13.5 V3.5" />
        <path d="M10.5 13.5 V9.5" />
        <path d="M14.5 13.5 V6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2 4 h12" />
      <path d="M2 8 h12" />
      <path d="M2 12 h8" />
    </svg>
  );
}

export function App() {
  const [view, setView] = useState<ViewId>(currentView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const status = useApi<Status>('/api/status', [syncNote]);

  useEffect(() => {
    const onHashChange = () => {
      setView(currentView());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const response = await startSync();
      setSyncNote(
        response.ok
          ? 'Sync started — reload in a minute.'
          : 'A sync is already running.',
      );
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : 'Sync could not be started.');
    } finally {
      setSyncing(false);
    }
  }

  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const coverage = status.state === 'ready' ? status.data.coverage : null;
  const lastSync = status.state === 'ready' ? status.data.lastSync : null;

  return (
    <div className="app">
      <nav className="sidebar" hidden={!menuOpen} id="nav" aria-label="Screens">
        <div className="brand">
          <Mark />
          <span className="brand-name">Fitness Tracker</span>
        </div>

        <div className="nav">
          {VIEWS.map((v) => (
            <a
              key={v.id}
              className="nav-item"
              href={`#${v.id}`}
              aria-current={v.id === view ? 'page' : undefined}
            >
              <NavIcon id={v.id} />
              {v.label}
            </a>
          ))}
        </div>

        <div className="sidebar-foot">
          Local SQLite database. No account, no hosting, nothing leaves this machine.
        </div>
      </nav>

      <header className="topbar">
        <button
          className="menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
          {active.label}
        </button>

        <div className="topbar-scope">
          {coverage?.start ? (
            <>
              <b className="fig">{num(coverage.total)}</b> rides ·{' '}
              <span>
                {longDate(coverage.start)} – {longDate(coverage.end ?? coverage.start)}
              </span>
            </>
          ) : (
            <span>No rides imported yet</span>
          )}
        </div>

        <div className="topbar-right">
          <span className="stamp">
            {syncNote ??
              (lastSync?.finished_at
                ? `Synced ${stamp(lastSync.finished_at)}`
                : 'Never synced')}
          </span>
          <button className="btn" type="button" onClick={sync} disabled={syncing}>
            {syncing ? 'Starting…' : 'Sync'}
          </button>
        </div>
      </header>

      <main className="sheet">{active.render()}</main>
    </div>
  );
}
