import { config } from '../config.js';
import { getAccessToken } from './auth.js';

/**
 * The download endpoint is strict about Accept: omitting application/x-zip-compressed
 * returns HTTP 406 NotAcceptableException rather than the file.
 */
const ZIP_ACCEPT = 'application/zip, application/x-zip-compressed, application/octet-stream';

export class GarminApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Garmin API ${status} on ${path}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'GarminApiError';
  }
}

type QueryValue = string | number | boolean | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Observed, undocumented: the API allows 100 requests per rolling window and then
 * answers 429 with `{"count":101,"limit":100,"retryInSeconds":33}`. The server tells
 * us how long to wait, so honour that rather than guessing a backoff.
 */
const MAX_RATE_LIMIT_RETRIES = 5;
const FALLBACK_RETRY_SECONDS = 35;

export type ThrottleListener = (waitSeconds: number) => void;
let onThrottle: ThrottleListener = () => {};
export function setThrottleListener(listener: ThrottleListener): void {
  onThrottle = listener;
}

function retryAfterSeconds(body: string, headerValue: string | null): number {
  try {
    const parsed = JSON.parse(body) as { retryInSeconds?: number };
    if (typeof parsed.retryInSeconds === 'number') return parsed.retryInSeconds;
  } catch {
    /* fall through to the header */
  }
  const fromHeader = Number(headerValue);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : FALLBACK_RETRY_SECONDS;
}

async function request(
  path: string,
  params: Record<string, QueryValue> | undefined,
  accept: string,
  retryOnAuthFailure = true,
  rateLimitRetries = 0,
): Promise<Response> {
  const url = new URL(config.baseUrl + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const token = await getAccessToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
  });

  // Tokens can be revoked before they expire. One forced refresh, then give up.
  if (response.status === 401 && retryOnAuthFailure) {
    await getAccessToken(true);
    return request(path, params, accept, false, rateLimitRetries);
  }

  if (response.status === 429) {
    if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
      throw new GarminApiError(429, path, 'Rate limited repeatedly; giving up');
    }
    const body = await response.text();
    const wait = retryAfterSeconds(body, response.headers.get('retry-after'));
    onThrottle(wait);
    await sleep((wait + 1) * 1000);
    return request(path, params, accept, retryOnAuthFailure, rateLimitRetries + 1);
  }

  if (!response.ok) {
    throw new GarminApiError(response.status, path, await response.text());
  }
  return response;
}

async function getJson<T>(path: string, params?: Record<string, QueryValue>): Promise<T | null> {
  const response = await request(path, params, 'application/json');
  const body = await response.text();
  return body ? (JSON.parse(body) as T) : null;
}

export interface ActivityListItem {
  activityId: number;
  activityName: string | null;
  startTimeLocal: string;
  startTimeGMT: string;
  activityType: { typeKey: string } | null;
  distance: number | null;
  duration: number | null;
  elapsedDuration: number | null;
  movingDuration: number | null;
  elevationGain: number | null;
  averageHR: number | null;
  maxHR: number | null;
  avgPower: number | null;
  normPower: number | null;
  calories: number | null;
}

export interface ActivitySummary {
  distance: number | null;
  duration: number | null;
  movingDuration: number | null;
  elapsedDuration: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  calories: number | null;
  averageHR: number | null;
  maxHR: number | null;
  averageBikeCadence: number | null;
  averagePower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  maxPowerTwentyMinutes: number | null;
  functionalThresholdPower: number | null;
  intensityFactor: number | null;
  trainingStressScore: number | null;
  /** EPOC-derived. Present on every ride, including those with no power meter. */
  activityTrainingLoad: number | null;
  trainingEffect: number | null;
  anaerobicTrainingEffect: number | null;
  trainingEffectLabel: string | null;
  averageTemperature: number | null;
}

export interface ActivityDetail {
  activityId: number;
  activityName: string | null;
  activityTypeDTO: { typeKey: string } | null;
  timeZoneUnitDTO: { timeZone: string } | null;
  metadataDTO: { manufacturer?: string; uploadedDate?: string; lastUpdateDate?: string } | null;
  summaryDTO: ActivitySummary | null;
  locationName: string | null;
}

export interface SearchOptions {
  start?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  activityType?: string;
}

export function searchActivities(options: SearchOptions = {}): Promise<ActivityListItem[] | null> {
  return getJson<ActivityListItem[]>('/activitylist-service/activities/search/activities', {
    start: options.start ?? 0,
    limit: options.limit ?? 20,
    startDate: options.startDate,
    endDate: options.endDate,
    activityType: options.activityType,
  });
}

export function getActivity(activityId: number): Promise<ActivityDetail | null> {
  return getJson<ActivityDetail>(`/activity-service/activity/${activityId}`);
}

export function getUserProfileSettings(): Promise<Record<string, unknown> | null> {
  return getJson('/userprofile-service/userprofile/settings');
}

export function getHeartRateZones(): Promise<unknown[] | null> {
  return getJson<unknown[]>('/biometric-service/heartRateZones/v2');
}

/** Returns the original activity file as ZIP bytes. The archive holds one `{id}_ACTIVITY.fit`. */
export async function downloadActivityFile(activityId: number): Promise<Buffer> {
  if (!Number.isInteger(activityId) || activityId <= 0) {
    throw new Error(`Invalid activity id: ${activityId}`);
  }
  const response = await request(
    `/download-service/files/activity/${activityId}`,
    undefined,
    ZIP_ACCEPT,
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Garmin returned an empty activity file for ${activityId}`);
  }
  return buffer;
}
