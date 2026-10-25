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
import {
  lastDays,
  levelsWith,
  moveEvent,
  PRESETS,
  presetOf,
  presetPhases,
  switchFor,
  TAPER_DAYS,
  TAPER_PCT,
  type Preset,
} from './planningScenario';

/** How far ahead an event may be, as the server checks it. */
const HORIZON_DAYS = 180;

/** How long a name may be, as the server checks it. */
const NAME_MAX = 60;

/** How long the controls wait for the rider to stop changing them before saving. */
const DEBOUNCE_MS = 400;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const INFO = {
  form: "What you carry into the day, before that day's riding: the same definition as on Overview.",
  projection:
    'The same arithmetic as the history, fed an assumed load instead of a measured one. It says what would happen if you rode exactly like this, not what to ride.',
  scenario:
    'Rest, Usual and Taper are names for common shapes, not advice. The load is spread evenly across the days. Real riding is not, and a hard ride a day or two before the event leaves form lower than shown. The usual is your own last four weeks, not a target. Every change is saved.',
};

/** The screen's question: where will I be on the day that matters? */
export function Planning() {
  /* The saved plan or the default, read on the first load and again after a clear. Every
     change after that is saved, and the save returns the report, so nothing else is read. */
  const [loads, setLoads] = useState(0);
  const latest = useApi<PlanningReport | null>(planningPath(null), [loads]);

  /* The report on the page: the last one loaded, or the one the last save returned. It stays
     while the next save is on its way or when it is refused, so the skeletons show only on
     the first load. Undefined until the first report; null when there is no history. */
  const [shown, setShown] = useState<PlanningReport | null | undefined>(undefined);
  const [draft, setDraft] = useState<SavedPlan | null>(null);
  /* The preset the rider chose. Kept apart from the draft, because a custom scenario can
     match a preset and must still show its controls. */
  const [preset, setPreset] = useState<Preset>('rest');
  /* Set when the next report should replace the controls: the first load, and a clear. */
  const reseed = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /* Counts the saves sent, so a reply that has been overtaken by a later one is dropped. */
  const sent = useRef(0);
  /* A change waiting out the debounce, or a save on its way. */
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (latest.state !== 'ready' || !reseed.current) return;
    reseed.current = false;
    setShown(latest.data);
    const day = latest.data ? addDays(latest.data.start.date, 1) : '';
    const next = latest.data ? draftFrom(latest.data, day) : null;
    setDraft(next);
    if (next) setPreset(presetOf(next, day));
    setClearing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Change the controls, and save once they have been still for a moment. */
  function edit(next: SavedPlan) {
    setDraft(next);
    setSaveError(null);
    clearTimeout(timer.current);
    /* A date field part-way through being typed is not a date yet: wait for one. */
    if (!ISO_DATE.test(next.eventDate)) {
      setPending(false);
      return;
    }
    setPending(true);
    timer.current = setTimeout(() => {
      setPending(false);
      void save(next);
    }, DEBOUNCE_MS);
  }

  async function save(plan: SavedPlan) {
    sent.current += 1;
    const n = sent.current;
    setSaving((count) => count + 1);
    try {
      const saved = await savePlan({ ...plan, name: cleanName(plan.name) });
      if (n === sent.current) setShown(saved);
    } catch (error) {
      if (n === sent.current) setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving((count) => count - 1);
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
      setLoads((n) => n + 1);
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
  const busy = pending || saving > 0;
  const datesOk = ISO_DATE.test(draft.eventDate);
  /* At most a day short of today, so the first share always holds a day. */
  const maxLast = datesOk ? Math.max(0, daysBetween(today, draft.eventDate) - 1) : 0;
  const last = datesOk ? lastDays(draft) : 0;

  function choose(next: Preset) {
    setPreset(next);
    if (next !== 'custom' && draft && datesOk) {
      edit({ ...draft, ...presetPhases(next, draft.eventDate, today) });
    }
  }

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
                  onChange={(e) => edit({ ...draft, name: e.target.value })}
                />
              </label>

              <label className="control">
                <span className="control-label">Event date</span>
                <input
                  className="field"
                  type="date"
                  min={addDays(today, 1)}
                  max={addDays(today, HORIZON_DAYS)}
                  value={draft.eventDate}
                  onChange={(e) => {
                    const eventDate = e.target.value;
                    if (!ISO_DATE.test(eventDate)) return edit({ ...draft, eventDate });
                    /* Move from the last whole date, so a half-typed one does not count. */
                    const from = datesOk ? draft : { ...draft, eventDate: report.scenario.eventDate };
                    edit({ ...draft, ...moveEvent(from, preset, eventDate, today) });
                  }}
                />
              </label>

              <div className="control" role="group" aria-label="Plan">
                <span className="control-label">Plan</span>
                <div className="seg seg-fill">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={p.id === preset}
                      onClick={() => choose(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {preset !== 'custom' && (
                  <span className="caption">{presetCaption(preset, usual.perWeek)}</span>
                )}
              </div>

              {preset === 'custom' && (
                <>
                  <Phase
                    label="Ride"
                    value={draft.beforePct}
                    perWeek={usual.perWeek}
                    onChange={(beforePct) => edit({ ...draft, beforePct })}
                  />
                  <label className="control">
                    <span className="control-label">Last days</span>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={maxLast}
                      step={1}
                      disabled={!datesOk}
                      value={last}
                      onChange={(e) => {
                        const days = Number(e.target.value);
                        if (e.target.value === '' || !Number.isFinite(days)) return;
                        const clamped = Math.min(maxLast, Math.max(0, Math.round(days)));
                        edit({ ...draft, switchDate: switchFor(draft.eventDate, clamped, today) });
                      }}
                    />
                    <span className="caption">
                      {last === 0
                        ? 'No change: the same share to the day'
                        : `${num(last)} ${last === 1 ? 'day' : 'days'} from ${shortDate(draft.switchDate)}, at the share below`}
                    </span>
                  </label>
                  {last > 0 && (
                    <Phase
                      label="Then ride"
                      value={draft.afterPct}
                      perWeek={usual.perWeek}
                      onChange={(afterPct) => edit({ ...draft, afterPct })}
                    />
                  )}
                </>
              )}

              {saveError && (
                <p className="state state-error" role="alert">
                  {saveError}
                </p>
              )}

              <div className="control-actions">
                <span className="caption">
                  {busy ? 'Saving…' : report.plan ? 'Saved' : 'Changes are saved as you make them'}
                </span>
                {report.plan && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={clear}
                    disabled={clearing || busy}
                  >
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
              {scenario.switchDate !== today && scenario.switchDate !== scenario.eventDate && (
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

/**
 * The first draft of the controls: what was projected, named after the saved plan when that
 * is what was projected. The dates come from the projection, so a saved switch that has gone
 * by reads as today, as the server projected it.
 */
function draftFrom(report: PlanningReport, today: string): SavedPlan {
  const { eventDate, switchDate, beforePct, afterPct, source } = report.scenario;
  const name = source === 'saved' ? (report.plan?.name ?? null) : null;
  const draft = { name, eventDate, switchDate, beforePct, afterPct };
  /* A custom scenario that switches today has an empty first phase, which the custom
     controls would still show. Say it as its one share to the day instead: the same days. */
  if (switchDate === today && presetOf(draft, today) === 'custom') {
    return { ...draft, beforePct: afterPct, switchDate: eventDate };
  }
  return draft;
}

/** A blank name is no name. */
function cleanName(name: string | null): string | null {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** What a preset rides, in points. */
function presetCaption(preset: Exclude<Preset, 'custom'>, perWeek: number): string {
  if (preset === 'rest') return 'No riding from today';
  if (preset === 'usual') return `${pointsText(100, perWeek)}, to the day`;
  return `${pointsText(100, perWeek)}, then ${pointsText(TAPER_PCT, perWeek)} for the last ${TAPER_DAYS} days`;
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
          paleColour: 'var(--control)',
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

/** One share of the usual load, as a few segments, with what the choice is in points. */
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
        {levelsWith(value).map((pct) => (
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
            {Array.from({ length: 4 }, (_, i) => (
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
