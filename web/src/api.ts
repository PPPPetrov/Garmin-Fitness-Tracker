import { useEffect, useState } from 'react';

export interface LoadDay {
  local_date: string;
  load_points: number;
  ride_count: number;
  fitness: number;
  fatigue: number;
  form: number;
  is_warmup: number;
  unmeasured_rides: number;
  is_estimated: number;
}

/** Where today's form sits against the rider's own measured history. */
export type FormBand = 'buried' | 'tired' | 'typical' | 'fresh' | 'freshest';

export interface FormPosition {
  date: string;
  form: number;
  fitness: number;
  percentile: number;
  rank: number;
  measuredDays: number;
  band: FormBand;
  streak: number;
  change: { days: number; form: number; fitness: number };
  lastInBand: string | null;
  confidence: { estimated: number; days: number };
}

export interface FormReading {
  position: FormPosition | null;
  windows: { change: number; confidence: number };
}

export interface Week {
  week: string;
  week_start: string;
  rides: number;
  hours: number;
  km: number;
  elevation_m: number;
  load_points: number;
}

/** Seconds in each heart-rate zone over a span, with the span before it. */
export interface ZoneTotals {
  from: string;
  to: string;
  seconds: number[];
  zoneSeconds: number;
  rides: number;
  ridesTotal: number;
  coverage: number | null;
}

export interface ZoneReading {
  period: ZoneTotals;
  previous: ZoneTotals;
}

export interface Activity {
  activity_id: number;
  activity_name: string | null;
  activity_type: string;
  local_date: string;
  start_time_local: string;
  distance_m: number | null;
  duration_s: number | null;
  moving_duration_s: number | null;
  elevation_gain_m: number | null;
  avg_power: number | null;
  normalized_power: number | null;
  max_power_20min: number | null;
  ftp_at_ride: number | null;
  intensity_factor: number | null;
  training_stress_score: number | null;
  activity_training_load: number | null;
  training_effect: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  location_name: string | null;
}

export interface Status {
  coverage: { start: string | null; end: string | null; total: number };
  fieldCoverage: { total: number; withLoad: number; withTss: number; unreliableLoad: number };
  lastSync: { finished_at: string | null; status: string } | null;
  syncing: boolean;
  timeZone: string;
}

export interface RideType {
  activity_type: string;
  n: number;
  powered: number;
  no_load: number;
  no_strap: number;
}

export interface PowerPoint {
  duration_s: number;
  watts: number;
  activity_id: number;
  local_date: string;
}

export interface PowerCurve {
  rows: PowerPoint[];
  /** Rides in range whose file disagreed with Garmin's own figures, so left out of `rows`. */
  heldBack: number;
}

/** One calendar year, counted only as far into it as today is. */
export interface Season {
  year: number;
  rides: number;
  hours: number;
  km: number;
  elevation_m: number;
  load_points: number;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export type Async<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T };

export function useApi<T>(path: string, deps: unknown[] = []): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setResult({ state: 'loading' });
    get<T>(path)
      .then((data) => {
        if (!cancelled) setResult({ state: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}

export function startSync(): Promise<Response> {
  return fetch('/api/sync', { method: 'POST' });
}

/** The Performance screen's figures. Mirrors `PerformanceReport` in src/calc/performance.ts. */
export interface EfficiencyMonth {
  month: string;
  median: number | null;
  rides: number;
}

export interface CriticalPowerMonth {
  month: string;
  cp: number | null;
  wPrimeJ: number | null;
  rides: number;
  garminFtp: number | null;
}

export interface PerformanceReport {
  efficiency: {
    months: EfficiencyMonth[];
    thisMonth: EfficiencyMonth;
    recent: number | null;
    before: number | null;
    change: number | null;
    recentSpan: [string, string];
    beforeSpan: [string, string];
    rides: number;
  };
  criticalPower: {
    months: CriticalPowerMonth[];
    window: { from: string; to: string; bests: { durationS: number; watts: number; date: string }[] };
  };
  ramp: {
    date: string;
    perWeek: number;
    percentile: number;
    percentAbove: number;
    band: 'lowest' | 'low' | 'middle' | 'high' | 'highest';
    lastInBand: string | null;
    estimated: boolean;
  } | null;
  heldBack: number;
  formula: { efficiency: string; criticalPower: string; ramp: string };
}
