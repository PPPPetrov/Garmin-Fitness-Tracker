import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Re-exchange the key once a token has less than this long to live. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let memoryToken: CachedToken | null = null;

function decodeExpiry(jwt: string): number {
  const payload = jwt.split('.')[1];
  if (!payload) throw new Error('Garmin returned a token that is not a JWT');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
  if (!claims.exp) throw new Error('Garmin token has no exp claim');
  return claims.exp * 1000;
}

function readCache(): CachedToken | null {
  try {
    return JSON.parse(readFileSync(config.tokenCachePath, 'utf8')) as CachedToken;
  } catch {
    return null;
  }
}

function writeCache(token: CachedToken): void {
  mkdirSync(dirname(config.tokenCachePath), { recursive: true });
  writeFileSync(config.tokenCachePath, JSON.stringify(token), { mode: 0o600 });
}

function usable(token: CachedToken | null): token is CachedToken {
  return token !== null && token.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

/**
 * Exchange the Personal API key for a bearer token.
 *
 * The endpoint returns the raw JWT as text/plain — not JSON — and the token lives
 * exactly 24 hours. There is no refresh token: renewing means exchanging the key again.
 */
async function exchangeKey(): Promise<CachedToken> {
  const response = await fetch(config.baseUrl + TOKEN_PATH, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${config.apiKey}` },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      response.status === 401
        ? `Garmin rejected the API key (401). It may have expired or been revoked — ` +
          `create a new one at https://connect.garmin.com/app/settings/personalApiToken`
        : `Token exchange failed: HTTP ${response.status} ${detail}`,
    );
  }

  const accessToken = (await response.text()).trim();
  return { accessToken, expiresAt: decodeExpiry(accessToken) };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    if (usable(memoryToken)) return memoryToken.accessToken;
    const cached = readCache();
    if (usable(cached)) {
      memoryToken = cached;
      return cached.accessToken;
    }
  }

  const token = await exchangeKey();
  memoryToken = token;
  writeCache(token);
  return token.accessToken;
}
