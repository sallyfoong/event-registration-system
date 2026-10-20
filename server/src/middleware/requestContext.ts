import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

import { runWithRequestId } from '../utils/requestContext';

// A request id turns "the API returned 500 at 14:32" into "this exact
// submission returned 500 at 14:32". The user reads the id off the response
// header (or support asks them to), and it appears on every log line that
// request produced - including lines written deep inside a service.
//
// An inbound id is reused when it looks sane, so a caller that already
// correlates (a proxy, a mobile app, a retry loop) keeps one id for the whole
// trace instead of getting a second one here.
//
// The pattern is an allow-list, not a length check: the value goes into log
// files, and a newline in it forges a second log line. Same reason the URL is
// passed through logSafe.

/** 8-64 characters of URL-safe text. Long enough for a UUID, short enough
 *  that it can't be used to bloat every log line. */
const ACCEPTED_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const inbound = req.get('x-request-id');
  const requestId = inbound && ACCEPTED_ID.test(inbound) ? inbound : randomUUID();

  // set before the handler runs: if a handler throws, the error response
  // still carries the id, which is the case where it matters most
  res.setHeader('X-Request-Id', requestId);

  // everything downstream - handlers, services, the error handler - runs
  // inside this context, so its log lines carry the id without being passed
  // anything
  runWithRequestId(requestId, next);
};
