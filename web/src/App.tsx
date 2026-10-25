import { useEffect, useState } from 'react';
import { startSync, useApi, type Status } from './api';
import { monthYear, num, stamp } from './format';
import { DatabaseIcon, MenuIcon, SearchIcon, SyncIcon } from './ui';
import { Activities } from './views/Activities';
import { Overview } from './views/Overview';
import { Performance } from './views/Performance';
import { Trends } from './views/Trends';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'performance', label: 'Performance' },
  { id: 'activities', label: 'Activities' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

function currentView(): ViewId {
  const hash = window.location.hash.replace('#', '');
  return VIEWS.some((v) => v.id === hash) ? (hash as ViewId) : 'overview';
}

/** The mark: the fitness curve rising to a point, white on the deep green. */
function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <rect width="30" height="30" rx="8" fill="var(--accent)" />
      <path
        d="M7 19.5 L11.5 14.5 L15 16.5 L21.5 9.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.5" cy="9.5" r="2.3" fill="#fff" />
    </svg>
  );
}

function NavIcon({ id }: { id: ViewId }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'overview') {
    return (
      <svg {...common}>
        <rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.5" />
        <rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.5" />
        <rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.5" />
        <rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.5" />
      </svg>
    );
  }
  if (id === 'trends') {
    return (
      <svg {...common}>
        <path d="M1.75 11.5 5.5 7.25l3 2.5 5.75-6" />
        <path d="M10.75 3.75h3.5v3.5" />
      </svg>
    );
  }
  if (id === 'performance') {
    /* A gauge: what the engine can do, as against the bike, which is the rides. */
    return (
      <svg {...common}>
        <path d="M2.25 12.25a5.75 5.75 0 1 1 11.5 0" />
        <path d="M8 12.25 10.75 7.5" />
        <path d="M4.25 8.5l.75.5M8 4.5v.9M11.75 8.5l-.75.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="4" cy="11.5" r="2.5" />
      <circle cx="12" cy="11.5" r="2.5" />
      <path d="M4 11.5 6.5 6h4L12 11.5M6.5 6 8 11.5h-4M9.25 4h1.75" />
    </svg>
  );
}

export function App() {
  const [view, setView] = useState<ViewId>(currentView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const status = useApi<Status>('/api/status', [syncNote]);

  useEffect(() => {
    const onHashChange = () => {
      setView(currentView());
      setMenuOpen(false);
      window.scrollTo(0, 0);
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
        response.ok ? 'Sync started — reload in a minute.' : 'A sync is already running.',
      );
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : 'Sync could not be started.');
    } finally {
      setSyncing(false);
    }
  }

  /** The search finds rides, so it always answers on the Activities screen. */
  function searchRides(term: string) {
    setSearch(term);
    if (view !== 'activities' && term.trim() !== '') window.location.hash = 'activities';
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

        <div className="nav-label">Menu</div>
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

        <div className="scope-card">
          <DatabaseIcon />
          <div className="scope-main">
            <div className="scope-title">
              {coverage ? (
                <>
                  <span className="fig">{num(coverage.total)}</span> rides
                </>
              ) : (
                'Local database'
              )}
            </div>
            <div className="scope-sub">
              {coverage?.start
                ? `${monthYear(coverage.start, true)} – ${monthYear(coverage.end ?? coverage.start, true)}`
                : 'Nothing imported yet'}
            </div>
          </div>
        </div>
      </nav>

      <div className="sheet">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="nav"
            aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
          <span className="topbar-title">
            <Mark size={24} />
            {active.label}
          </span>

          <label className="search">
            <input
              type="search"
              placeholder="Search rides by name or place"
              aria-label="Search rides by name or place"
              value={search}
              onChange={(e) => searchRides(e.target.value)}
            />
            <SearchIcon />
          </label>

          <div className="topbar-right">
            <span className="stamp">
              {syncNote ??
                (lastSync?.finished_at ? `Synced ${stamp(lastSync.finished_at)}` : 'Never synced')}
            </span>
            <button className="btn" type="button" onClick={sync} disabled={syncing}>
              <SyncIcon />
              {syncing ? 'Starting…' : 'Sync'}
            </button>
          </div>
        </header>

        <main className="page">
          {view === 'overview' && <Overview />}
          {view === 'trends' && <Trends />}
          {view === 'performance' && <Performance />}
          {view === 'activities' && <Activities search={search} onSearch={setSearch} />}
        </main>
      </div>
    </div>
  );
}
