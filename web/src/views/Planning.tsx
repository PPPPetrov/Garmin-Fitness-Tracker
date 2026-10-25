import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  clearPlan,
  planningPath,
  savePlan,
  useApi,
  type PlanningReport,
  type SavedPlan,
} from '../api';
import { LineChart, LineLegend, type Annotation } from '../charts/Line';
import { addDays, DASH, dayDate, num, shortDate, signed } from '../format';
import { Card } from '../ui';
import { formCaption, planningFinding, pointsText } from './planningCopy';

/** The shares of the usual load a phase can take, as the server accepts them. */
const STEPS = [0, 25, 50, 75, 100, 125, 150];

/** How far ahead an event may be, as the server checks it. */
const HORIZON_DAYS = 180;

/** How long a name may be, as the server checks it. */
const NAME_MAX = 60;

/** How long the controls wait for the rider to stop changing them before re-projecting. */
const DEBOUNCE_MS = 250;

const INFO = {
  form: "What you carry into the day, before that day's riding: the same definition as on Overview.",
  projection:
    'The same arithmetic as the history, fed an assumed load instead of a measured one. It says what would happen if you rode exactly like this, not what to ride.',
  scenario:
    'The load is spread evenly across the days. Real riding is not, and a hard ride a day or two before the event leaves form lower than shown. The usual is your own last four weeks, not a target.',
};

/** The screen's question: where will I be on the day that matters? */
export function Planning() {
  /* What `useApi` reads. It changes only when a control is changed (after the debounce) or
     when the plan is cleared, so the first load asks for the saved plan or the default.
     `n` counts the requests issued, so the same path can be asked again and a response
     can be told apart from one issued later. */
  const [request, setRequest] = useState({ path: planningPath(null), n: 0 });
  const latest = useApi<PlanningReport | null>(request.path, [request.path, request.n]);
  /* Requests up to this number were issued before the last save landed: their reports
     carry the plan as it was, so they must not replace the one the save returned. */
  const staleUpTo = useRef(-1);
  const issued = useRef(0);
  const stale = request.n <= staleUpTo.current;

  /* The report on the page: the last one that arrived, or the one a save returned. It stays
     while the next one loads or when the next one is refused, so the skeletons show only on
     the first load. Undefined until the first report; null when there is no history. */
  const [shown, setShown] = useState<PlanningReport | null | undefined>(undefined);
  const [draft, setDraft] = useState<SavedPlan | null>(null);
  const draftNow = useRef<SavedPlan | null>(null);
  draftNow.current = draft;
  /* Set when the next report should replace the controls: the first load, and a clear. */
  const reseed = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /* A change waiting out the debounce, so the page does not yet show what the controls say. */
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (latest.state !== 'ready' || stale) return;
    setShown(latest.data);
    if (reseed.current) {
      reseed.current = false;
      setDraft(latest.data ? draftFrom(latest.data) : null);
      setClearing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function ask(path: string) {
    issued.current += 1;
    setRequest({ path, n: issued.current });
  }

  /** Change the controls, and re-project once they have been still for a moment. */
  function edit(change: Partial<SavedPlan>) {
    if (!draft) return;
    const next = { ...draft, ...change };
    setDraft(next);
    setSaveError(null);
    clearTimeout(timer.current);
    setPending(true);
    timer.current = setTimeout(() => {
      setPending(false);
      ask(planningPath(next));
    }, DEBOUNCE_MS);
  }

  async function save() {
    if (!draft) return;
    const sent = draft;
    clearTimeout(timer.current);
    setPending(false);
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePlan({ ...sent, name: cleanName(sent.name) });
      staleUpTo.current = issued.current;
      setShown(saved);
      /* A control changed while the save was on its way: project what the controls say now. */
      const now = draftNow.current;
      if (now && now !== sent) ask(planningPath(now));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaveError(null);
    clearTimeout(timer.current);
    setPending(false);
    setClearing(true);
    try {
      await clearPlan();
      reseed.current = true;
      ask(planningPath(null));
    } catch (error) {
      setClearing(false);
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  if (shown === undefined) {
    return latest.state === 'error' ? <Frames error={latest.message} /> : <Loading />;
  }
  if (shown === null || !draft) return <Frames />;

  const report = shown;
  const { start, usual, series, event, peak, switchDay, scenario } = report;
  /* Today from the report's own dates, not the browser clock: the day after the start. */
  const today = addDays(start.date, 1);
  const eventRow = series[series.length - 1];
  const lessSure = eventRow?.estimated ? ' · less sure' : '';
  const name = cleanName(draft.name);
  const unsaved = isUnsaved(draft, report.plan);
  const queryError = latest.state === 'error' && !stale ? latest.message : null;

  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Planning</h1>
          <p className="subtitle">{planningFinding(report, today)}</p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-1-1-1">
          <Card title="Projected form on the day" info={INFO.form}>
            <Kpi figure={signed(event.form, 1)} caption={`${formCaption(event)}${lessSure}`} />
          </Card>
          <Card title="Projected fitness on the day">
            {/* A fall in a hypothetical is neither good nor bad, so the change stays grey. */}
            <Kpi
              figure={num(event.fitness, 1)}
              caption={`${signed(Number(event.fitnessChange.toFixed(1)), 1)} on yesterday${lessSure}`}
            />
          </Card>
          <Card title="To go">
            <Kpi
              figure={num(daysBetween(today, event.date))}
              unit={daysBetween(today, event.date) === 1 ? 'day' : 'days'}
              caption={`${dayDate(event.date)}${name ? ` · ${name}` : ''}`}
            />
          </Card>
        </div>

        <div className="grid grid-2-1">
          <Card
            title="Projection"
            info={INFO.projection}
            aside={
              <LineLegend
                series={[
                  { name: 'Form', colour: 'var(--chart-1)' },
                  { name: 'Fitness', colour: 'var(--chart-2)' },
                ]}
              />
            }
          >
            <ProjectionChart report={report} today={today} name={name} />
            <p className="note">
              Pale from {shortDate(series.find((d) => d.projected)?.date ?? today)}: an assumed
              load, not a measured one.
            </p>
          </Card>

          <Card title="Scenario" info={INFO.scenario}>
            <div className="controls">
              <label className="control">
                <span className="control-label">Name</span>
                <input
                  className="field"
                  type="text"
                  maxLength={NAME_MAX}
                  placeholder="What the day is"
                  value={draft.name ?? ''}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              </label>

              <div className="control-pair">
                <label className="control">
                  <span className="control-label">Event date</span>
                  <input
                    className="field"
                    type="date"
                    min={addDays(today, 1)}
                    max={addDays(today, HORIZON_DAYS)}
                    value={draft.eventDate}
                    onChange={(e) => edit({ eventDate: e.target.value })}
                  />
                </label>
                <label className="control">
                  <span className="control-label">Switch date</span>
                  <input
                    className="field"
                    type="date"
                    min={today}
                    max={draft.eventDate}
                    value={draft.switchDate}
                    onChange={(e) => edit({ switchDate: e.target.value })}
                  />
                </label>
              </div>

              <Phase
                label="Before the switch"
                value={draft.beforePct}
                perWeek={usual.perWeek}
                onChange={(beforePct) => edit({ beforePct })}
              />
              <Phase
                label="After the switch"
                value={draft.afterPct}
                perWeek={usual.perWeek}
                onChange={(afterPct) => edit({ afterPct })}
              />

              {(queryError ?? saveError) && (
                <p className="state state-error" role="alert">
                  {queryError ?? saveError}
                </p>
              )}

              <div className="control-actions">
                <button
                  className="btn-quiet"
                  type="button"
                  onClick={save}
                  disabled={saving || pending || latest.state !== 'ready' || queryError != null}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {unsaved && <span className="caption">Not saved</span>}
                {report.plan && (
                  <button className="text-button" type="button" onClick={clear} disabled={clearing}>
                    Clear plan
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-1-1">
          <Card title="Along the way">
            <div className="rows">
              <Row
                name="Form turns positive"
                sub={start.form >= 0 ? 'Form is already above zero' : 'The first day at zero or more'}
                figure={
                  report.turnsPositive
                    ? shortDate(report.turnsPositive)
                    : start.form >= 0
                      ? 'Already positive'
                      : 'Not before the event'
                }
              />
              <Row
                name="Peak form"
                sub={`${shortDate(peak.date)} · fitness ${num(peak.fitness, 1)}`}
                figure={signed(peak.form, 1)}
              />
              {scenario.switchDate !== today && (
                <Row
                  name="At the switch"
                  sub={`${shortDate(switchDay.date)} · fitness ${num(switchDay.fitness, 1)}`}
                  figure={signed(switchDay.form, 1)}
                />
              )}
            </div>
          </Card>

          <Card title="What this rests on">
            <div className="rows">
              <Row
                name="The start"
                sub={`${shortDate(start.date)} · fitness ${num(start.fitness, 1)}, fatigue ${num(start.fatigue, 1)}`}
                figure={signed(start.form, 1)}
                unit="form"
              />
              <Row
                name="The usual"
                sub={`From ${num(usual.rides)} ${usual.rides === 1 ? 'ride' : 'rides'} in the ${num(
                  daysBetween(usual.from, usual.to) + 1,
                )} days to ${shortDate(usual.to)}`}
                figure={num(usual.perWeek)}
                unit="a week"
              />
              {usual.unmeasured > 0 && (
                <Row
                  name="Reads low"
                  sub={`${num(usual.unmeasured)} of them ${
                    usual.unmeasured === 1 ? 'has' : 'have'
                  } no usable load, so the usual reads low`}
                  figure={num(usual.unmeasured)}
                />
              )}
              <LessSure until={report.lessSureUntil} />
              <Row name="Formula" sub="The same as the history" figure={report.formula} small />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** The first draft of the controls: the saved plan while its event is ahead, else what was projected. */
function draftFrom(report: PlanningReport): SavedPlan {
  if (report.plan && report.past == null) return { ...report.plan };
  const { eventDate, switchDate, beforePct, afterPct } = report.scenario;
  return { name: null, eventDate, switchDate, beforePct, afterPct };
}

/** A blank name is no name. */
function cleanName(name: string | null): string | null {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Whether the controls differ from the saved plan in any field. With no plan, always. */
function isUnsaved(draft: SavedPlan, plan: SavedPlan | null): boolean {
  if (!plan) return true;
  return (
    cleanName(draft.name) !== cleanName(plan.name) ||
    draft.eventDate !== plan.eventDate ||
    draft.switchDate !== plan.switchDate ||
    draft.beforePct !== plan.beforePct ||
    draft.afterPct !== plan.afterPct
  );
}

/** Whole days from one ISO date to another, in UTC so no daylight-saving hour counts. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}

/** Form and fitness through the last 42 days and on to the event, the projection pale. */
function ProjectionChart({
  report,
  today,
  name,
}: {
  report: PlanningReport;
  today: string;
  name: string | null;
}) {
  const { series, scenario } = report;
  const last = series.length - 1;
  const firstProjected = series.findIndex((d) => d.projected);
  const paleFrom = firstProjected < 0 ? undefined : firstProjected;
  const at = (date: string) => series.findIndex((d) => d.date === date);

  const annotations: Annotation[] = [];
  const todayIndex = at(today);
  if (todayIndex >= 0) {
    annotations.push({ index: todayIndex, value: series[todayIndex]!.form, label: 'today' });
  }
  /* No switch marker when the switch is today (the today marker is it) or the event day
     (the after phase is empty, and the event marker is there). */
  const switchIndex = at(scenario.switchDate);
  if (scenario.switchDate !== today && switchIndex >= 0 && switchIndex !== last) {
    annotations.push({
      index: switchIndex,
      value: series[switchIndex]!.form,
      label: `${scenario.afterPct}%`,
    });
  }
  annotations.push({ index: last, value: series[last]!.form, label: name ?? 'event' });

  return (
    <LineChart
      labels={series.map((d) => shortDate(d.date))}
      tipLabels={series.map((d) => `${dayDate(d.date)}${d.projected ? ' · projected' : ''}`)}
      height={300}
      yUnit="points"
      format={(v) => num(v, 1)}
      annotations={annotations}
      series={[
        {
          name: 'Fitness',
          colour: 'var(--chart-2)',
          width: 1.5,
          values: series.map((d) => d.fitness),
          paleFrom,
          paleColour: 'var(--border)',
        },
        {
          name: 'Form',
          colour: 'var(--chart-1)',
          width: 2.5,
          values: series.map((d) => d.form),
          paleFrom,
          paleColour: 'var(--accent-200)',
        },
      ]}
    />
  );
}

/** One share of the usual load, as seven segments, with what the choice is in points. */
function Phase({
  label,
  value,
  perWeek,
  onChange,
}: {
  label: string;
  value: number;
  perWeek: number;
  onChange: (pct: number) => void;
}) {
  return (
    <div className="control" role="group" aria-label={label}>
      <span className="control-label">{label}</span>
      <div className="seg seg-fill">
        {STEPS.map((pct) => (
          <button
            key={pct}
            type="button"
            aria-pressed={pct === value}
            onClick={() => onChange(pct)}
          >
            {pct}%
          </button>
        ))}
      </div>
      <span className="caption">{pointsText(value, perWeek)}</span>
    </div>
  );
}

/** Until when the projection rests on a 42-day window with an unmeasured ride in it. */
function LessSure({ until }: { until: string | null }) {
  if (until == null) return null;
  return (
    <Row
      name="Less sure until"
      sub="A ride with no usable load is in the 42-day window"
      figure={shortDate(until)}
    />
  );
}

function Kpi({ figure, unit, caption }: { figure: string; unit?: string; caption: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-text">
        <div className="figure">
          {figure}
          {unit && <span className="unit"> {unit}</span>}
        </div>
        <div className="caption">{caption}</div>
      </div>
    </div>
  );
}

function Row({
  name,
  sub,
  figure,
  unit,
  small,
}: {
  name: string;
  sub: string;
  figure: string;
  unit?: string;
  small?: boolean;
}) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-name">{name}</div>
        <div className="row-sub">{sub}</div>
      </div>
      <div className="row-figure" style={small ? { fontSize: 'var(--fs-small)' } : undefined}>
        {figure === DASH ? <span className="dash">{DASH}</span> : figure}
        {unit && <span className="unit"> {unit}</span>}
      </div>
    </div>
  );
}

const KPI_TITLES = ['Projected form on the day', 'Projected fitness on the day', 'To go'];

/**
 * Every card's frame with nothing to show: no history yet, or the first load failed. The
 * failure sits in the Projection card, the screen's main block.
 */
function Frames({ error }: { error?: string }) {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Planning</h1>
          <p className="subtitle">
            {error
              ? 'The numbers below could not be read from the local database.'
              : 'Nothing synced yet, so there is nothing to project from.'}
          </p>
        </div>
      </div>
      <div className="stack">
        <div className="grid grid-1-1-1">
          {KPI_TITLES.map((title) => (
            <Card title={title} key={title}>
              <Kpi figure={DASH} caption={' '} />
            </Card>
          ))}
        </div>
        <div className="grid grid-2-1">
          <Card title="Projection" info={INFO.projection}>
            {error ? (
              <p className="state state-error">
                Could not load the projection: {error}. The API server may not be running. Start
                it with <code>npm run dev</code>.
              </p>
            ) : (
              <p className="state">Nothing synced yet, so there is nothing to project from.</p>
            )}
          </Card>
          <Card title="Scenario" info={INFO.scenario}>
            <p className="state">The controls open once there is a history to project from.</p>
          </Card>
        </div>
        <div className="grid grid-1-1">
          <Card title="Along the way">
            <p className="state">Nothing to project yet.</p>
          </Card>
          <Card title="What this rests on">
            <p className="state">No rides synced yet.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** The final layout with each value a flat bar at its real size: nothing shifts. */
function Loading() {
  return (
    <>
      <div className="title-row">
        <div className="title-block">
          <h1>Planning</h1>
          <p className="subtitle">Reading the local database…</p>
        </div>
      </div>
      <div className="stack">
        <div className="grid grid-1-1-1">
          {KPI_TITLES.map((title) => (
            <Card title={title} key={title}>
              <div className="skeleton skeleton-value" />
              <div className="caption">&nbsp;</div>
            </Card>
          ))}
        </div>
        <div className="grid grid-2-1">
          <Card title="Projection">
            <div className="skeleton skeleton-plot" style={{ height: 300 }} />
          </Card>
          <Card title="Scenario">
            {Array.from({ length: 7 }, (_, i) => (
              <div className="skeleton skeleton-row" key={i} style={{ width: '100%' }} />
            ))}
          </Card>
        </div>
        <div className="grid grid-1-1">
          <Card title="Along the way">
            {Array.from({ length: 3 }, (_, i) => (
              <div className="skeleton skeleton-row" key={i} style={{ width: '100%' }} />
            ))}
          </Card>
          <Card title="What this rests on">
            {Array.from({ length: 5 }, (_, i) => (
              <div className="skeleton skeleton-row" key={i} style={{ width: '100%' }} />
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
