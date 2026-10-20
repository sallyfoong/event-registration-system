import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import adminRoutes from './routes/adminRoutes';
import publicRoutes from './routes/publicRoutes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';

// app is split from the startup script (index.ts) so tests can import the
// express app directly: supertest sends requests without binding port 8000,
// so a dozen parallel test files never fight over a port.

const app = express();

// don't advertise the express version; it only helps someone probing for
// known CVEs against a specific release
app.disable('x-powered-by');
// The brief defines exactly four statuses and says a success is 200.
// Express's default ETag answers a repeat GET carrying If-None-Match with
// 304, which is none of the four - and a 304 has no body for a test tool to
// assert on. Repeat reads are already handled by the in-process cache, which
// says so in X-Cache instead of changing the status code.
app.set('etag', false);
// only enable this when running behind a reverse proxy, so req.ip / rate
// limiting see the real client IP. Default is off (env.trustProxy = 0):
// when directly exposed, blindly trusting X-Forwarded-For lets an attacker
// rotate the header per request and appear as a brand-new IP each time,
// which makes rate limiting a no-op.
app.set('trust proxy', env.trustProxy);

// first in the chain, before anything that can fail: a request that dies in
// a later middleware still needs an id, and that is exactly the request whose
// logs someone will be reading
app.use(requestContext);

app.use(helmet()); // security headers must go out before any response body

app.use(
  cors({
    // origins come from config, not '*': '*' means any website can call
    // the API from a browser
    origin: env.corsOrigins,
    methods: ['GET', 'POST'],
    credentials: false,
    // Without this the browser can't read these two headers off the
    // response, which is the difference between "the cache is observable"
    // and "the cache is observable from curl only". Same-origin production
    // traffic is unaffected; this matters in local dev, where the web app
    // runs on 8001 and the API on 8000.
    exposedHeaders: ['X-Request-Id', 'X-Cache'],
  }),
);

// 100kb cap: the largest legitimate body here is a few dozen bytes of JSON.
// Uncapped, a multi-MB request is enough to eat memory - a dirt-cheap DoS.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// after body parsing, before routes: every incoming request gets logged,
// and even a failed body parse (421) already has the request logger attached
app.use(requestLogger);

// two limit tiers, split by who calls. Placement matters: they must sit
// before the matching routes, otherwise the request is already handled
// and the limiter never runs.

// public: 100/min - the callers are strangers, and a normal user doesn't
// tap an endpoint a hundred times a minute.
app.use(
  '/api/public',
  rateLimit({
    windowMs: 60_000,
    limit: 100,
    // draft-7: emit standard RateLimit-* headers so clients can compute
    // their remaining budget themselves
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  }),
);

// admin: 600/min. Generous not because staff are trusted, but because these
// endpoints are expensive: the trend endpoint scans all registrations and
// buckets in memory, and the list search uses %term% LIKE which can't use
// an index - a script hammering either can still drag the DB down. But staff
// paginate and toggle filters constantly; tightening this to the public tier
// just blocks real people first.
app.use(
  '/api/admin',
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  }),
);

// liveness probe for container orchestration / load balancers.
// Deliberately does NOT touch the database: a failed probe restarts the
// container, and restarting the app when the DB is down accomplishes
// nothing except making the restart storm worse.
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// the order of these two must never swap: notFoundHandler is registered
// first, so unmatched requests become 404s here. errorHandler needs exactly
// 4 parameters - express identifies error middleware by argument count, and
// with one fewer it's treated as ordinary middleware and never fires.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
