import axios, { AxiosInstance } from 'axios';

import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  AppError,
  HttpStatus,
  INVALID_INPUT_MESSAGE,
  clientError,
  serverError,
} from '../utils/errors';
import { logSafe } from '../utils/logSafe';

// Creating an event needs an address, but employees only type a 6-digit
// postal code. The brief is explicit - "postal code must be validated
// against OneMap API" - so there is exactly one way an event gets created:
// OneMap returned an address for that code. Three ways this can go:
//   1. not even 6 digits            -> the user's mistake, 400
//   2. OneMap is up, no such code   -> the user's mistake too, 421 on the field
//   3. OneMap unreachable / 401/5xx -> we cannot validate, so we don't guess: 500
//
// A build with no credentials at all is case 3, not an exception. It cannot
// honour "must be validated", and the alternative - storing
// "Singapore <postal code>" and returning 200 - fills the database with
// addresses nobody checked while every response looks healthy. So this
// refuses, loudly: an error at boot and a 500 on the request.
//
// Tests and the E2E suite stand in a stub OneMap rather than loosening this
// path - see src/tests/setupFiles.ts and e2e/serve-api.mjs. A test that can
// only pass because validation is switched off is testing the wrong system.

interface OneMapAuthResponse {
  access_token?: string;
  expiry_tm?: string;
}

interface OneMapSearchResponse {
  found?: number;
  /** OneMap's own complaint, usually about the token. It shows up on
   *  responses that also carry a correct result set, so nothing here acts on
   *  it; it is declared because it is part of the payload, not because it
   *  means anything. */
  error?: string;
  results?: Array<{
    SEARCHVAL?: string;
    BLK_NO?: string;
    ROAD_NAME?: string;
    BUILDING?: string;
    ADDRESS?: string;
    POSTAL?: string;
  }>;
}

interface CachedToken {
  token: string;
  expiryTimestampMs: number;
}

// One token per process. Not in the database or Redis: it lives for three
// days and this runs as a single instance, so memory is plenty. Several
// instances each holding their own token is fine too - OneMap doesn't limit
// how many tokens an account can hold.
let cachedToken: CachedToken | null = null;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const http: AxiosInstance = axios.create({
  baseURL: env.onemap.baseUrl,
  // 8s timeout. Event creation is a synchronous request, nobody should
  // sit watching a spinner for half a minute.
  timeout: 8000,
});

/** Reads `exp` out of a JWT without verifying the signature.
 *
 *  There is nothing here to verify it with - OneMap holds the key - and a
 *  forged token gets rejected by them a moment later anyway. The only use is
 *  deciding whether the token is worth reusing, so a failed parse returns
 *  null and the caller carries on. */
export const tokenExpiryMs = (token: string): number | null => {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = (decoded as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** Configured means "we have something to authenticate with": either a
 *  pre-issued token, or an account to log in with. */
export const isOneMapConfigured = (): boolean =>
  Boolean(env.onemap.token || (env.onemap.email && env.onemap.password));

/** Fetch an access token, cached.
 *  Expiry is checked 60s early so the token can't expire in the gap between
 *  the check and the request that uses it. */
const getAccessToken = async (): Promise<string> => {
  if (cachedToken && cachedToken.expiryTimestampMs > Date.now() + 60_000) {
    return cachedToken.token;
  }

  // A pre-issued token (ONEMAP_TOKEN) skips the login round trip entirely.
  // This is what a deployment uses: no password in the environment, and
  // renewing is a deliberate act every three days rather than a side effect
  // of a restart.
  if (env.onemap.token) {
    cachedToken = {
      token: env.onemap.token,
      // an unreadable expiry is treated as "good for one call": the token is
      // still handed to OneMap, it just doesn't get trusted for longer
      expiryTimestampMs: tokenExpiryMs(env.onemap.token) ?? Date.now() + 60_000,
    };
    return env.onemap.token;
  }

  const response = await http.post<OneMapAuthResponse>('/api/auth/post/getLoginToken', {
    email: env.onemap.email,
    password: env.onemap.password,
  });

  const token = response.data?.access_token;
  // Don't trust the response: a 200 can still come back without a token.
  // Throw here and let resolveAddress turn every lookup failure into the
  // same 500, in one place.
  if (!token) {
    throw new Error('OneMap authentication response did not contain an access token');
  }

  cachedToken = {
    token,
    expiryTimestampMs: tokenExpiryMs(token) ?? Date.now() + THREE_DAYS_MS,
  };
  return token;
};

/** A token OneMap rejected can be replaced, but only if there is an account
 *  to log in with - a pre-issued token has to be renewed by hand. */
const canRefreshToken = (): boolean => Boolean(env.onemap.email && env.onemap.password);

const isUnauthorized = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 401;

/** Look up an address by postal code. Returns null when there's no match
 *  - null means "no such code", not "error". Throws when there is nothing
 *  configured to ask, because "I did not look" and "it is not there" are
 *  different answers and only one of them is the caller's fault. */
export const lookupAddressByPostalCode = async (
  postalCode: string,
): Promise<{ address: string; postalCode: string } | null> => {
  if (!isOneMapConfigured()) {
    throw new Error('OneMap is not configured: no postal code can be validated');
  }

  const search = async (): Promise<OneMapSearchResponse> => {
    const token = await getAccessToken();
    const response = await http.get<OneMapSearchResponse>('/api/common/elastic/search', {
      params: {
        searchVal: postalCode,
        returnGeom: 'N',
        getAddrDetails: 'Y',
        pageNum: 1,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  };

  let data: OneMapSearchResponse;
  try {
    data = await search();
  } catch (error: unknown) {
    // A 401 is the one failure worth retrying: the token expired while this
    // process was running, and the fix is a new one. Anything else (timeout,
    // 5xx) will fail the same way twice, so it goes straight up.
    if (!isUnauthorized(error) || !canRefreshToken()) throw error;
    logger.warn('OneMap rejected the cached token; logging in again');
    cachedToken = null;
    data = await search();
  }

  // Take the first hit. A postal code maps to a building, so if there are
  // several results the first is the closest match.
  const first = data?.results?.[0];
  if (!first?.ADDRESS) {
    // `data.error` is deliberately ignored here. OneMap attaches "Invalid
    // authentication token" to plenty of responses that carry a correct
    // result, so it is not evidence of anything - treating it as a failure
    // would reject postal codes that do exist. A token OneMap really refuses
    // comes back as a 401, which is handled above.
    return null;
  }
  // POSTAL can be missing; fall back to the code we searched for so the
  // returned shape stays the same.
  return { address: first.ADDRESS, postalCode: first.POSTAL ?? postalCode };
};

/** The only function the event service calls. Resolves with an address
 *  OneMap returned, or throws - there is no third outcome. */
export const resolveAddress = async (postalCode: string): Promise<string> => {
  // Format first, whoever is configured: a regex costs nothing and there is
  // no reason to spend an HTTP round trip on "12AB56".
  if (!/^\d{6}$/.test(postalCode)) {
    throw clientError('Please enter a valid 6-digit Singapore postal code.');
  }

  if (!isOneMapConfigured()) {
    // Nothing to ask. Refusing is the only answer that keeps the promise the
    // brief makes; a 200 here would be an address nobody looked up.
    logger.error(
      'OneMap is not configured: refusing to create an event without a validated address.',
    );
    throw serverError(
      'We could not verify this postal code just now. Please try again in a moment.',
    );
  }

  let result: { address: string; postalCode: string } | null;
  try {
    result = await lookupAddressByPostalCode(postalCode);
  } catch (error: unknown) {
    // Timeouts, 401s and 5xxs. The employee typed something reasonable and
    // we still can't confirm it, so this is our failure, not their input.
    logger.error(
      `OneMap lookup failed for postal code "${logSafe(postalCode)}": ${logSafe(error instanceof Error ? error.message : error)}`,
    );
    throw serverError(
      'We could not check this postal code with OneMap just now. Please try again in a moment.',
    );
  }

  if (!result) {
    // OneMap answered and doesn't know this code - the input is wrong, and
    // the message is pinned to the field so the form can point at it.
    logger.warn(`OneMap has no address for postal code "${logSafe(postalCode)}"`);
    throw new AppError(HttpStatus.VALIDATION_ERROR, INVALID_INPUT_MESSAGE, [
      {
        field: 'postalCode',
        message: 'OneMap could not find an address for this postal code. Please check it.',
      },
    ]);
  }

  return result.address;
};
