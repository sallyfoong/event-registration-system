import { NextFunction, Request, Response } from 'express';

import { logger } from '../config/logger';
import { logSafe } from '../utils/logSafe';

// logging on 'finish' rather than after next() returns: when next() returns
// the response isn't written yet (handlers are async), only the finish event
// marks the actual end of the request.
//
// no morgan: winston is already in place, and adding a second logging library
// means two formats and two rotation setups for something these ~15 lines do.

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    // method + url + status + duration covers most triage needs.
    // deliberately no body: it can contain emails and other PII.
    // the URL must go through logSafe: %0a in the query decodes to a real
    // newline, letting an attacker forge a clean-looking fake log line.
    logger.info(`${req.method} ${logSafe(req.originalUrl)} ${res.statusCode} ${durationMs}ms`);
  });
  next();
};
