import dotenv from 'dotenv';
import path from 'path';

// the only module allowed to touch process.env. Keeping every variable name
// and default in one place means "what is this config called" has exactly
// one answer, and tests / deploys only need to change this layer's input.
//
// the .env path is resolved from __dirname rather than the current working
// directory - starting via `npm --prefix` from the repo root would otherwise
// miss server/.env entirely.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** env vars are strings; ports and friends need coercion to numbers.
 *  isNaN check rather than Number(): Number('') is 0, which would silently
 *  turn "not configured" into "configured as 0". */
const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // tests want SQL and file logging off - otherwise one test run floods
  // the screen and logs/
  isTest,
  port: toInt(process.env.PORT, 8000),
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'error' : 'info'),
  // comma-separated so local + staging origins can coexist
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:8001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // page size is config, not a query parameter: otherwise the client sends
  // pageSize=100000 and takes the DB down with it
  pageSize: toInt(process.env.PAGE_SIZE, 10),
  // how long a cached read stays fresh, in milliseconds; 0 turns the cache
  // off. Tests default to 0: the suite drives the same tables through many
  // cases, and a read served from a previous case's cache would fail in a way
  // that looks like a business-rule bug. Production defaults to 10s - long
  // enough that a page refresh doesn't hit the database, short enough that
  // another instance's writes are noticed quickly (see utils/cache.ts for why
  // staleness across instances is bounded by the TTL and not by invalidation).
  cacheTtlMs: toInt(process.env.CACHE_TTL_MS, isTest ? 0 : 10_000),
  // only turn on behind a reverse proxy (trusts one hop of X-Forwarded-For).
  // Default 0 is deliberate: when directly exposed, unconditionally trusting
  // XFF means the client supplies its own IP and rate limiting (which is
  // per-IP) is trivially bypassed by rotating the header.
  trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : 0,
  db: {
    // mysql by default for production; sqlite for tests and local convenience
    dialect: (process.env.DB_DIALECT ?? 'mysql') as 'mysql' | 'sqlite',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME ?? 'event_registration',
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    storage: process.env.DB_STORAGE ?? './data/dev.sqlite',
    // default false: never let a boot sequence alter production tables on
    // its own - schema changes should be explicit
    syncAlter: process.env.SYNC_ALTER === 'true',
  },
  onemap: {
    // a pre-issued access token (three days). Takes precedence over the
    // account below: it needs no login round trip and keeps the password out
    // of the environment.
    token: process.env.ONEMAP_TOKEN ?? '',
    // empty credentials mean "OneMap disabled" - fall back to postal code
    // format validation
    email: process.env.ONEMAP_EMAIL ?? '',
    password: process.env.ONEMAP_PASSWORD ?? '',
    baseUrl: process.env.ONEMAP_BASE_URL ?? 'https://www.onemap.gov.sg',
  },
};
