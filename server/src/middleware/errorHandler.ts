import { NextFunction, Request, Response } from 'express';
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';

import { logger } from '../config/logger';
import { isDuplicateEmailError } from '../models';
import { AppError, HttpStatus, INVALID_INPUT_MESSAGE } from '../utils/errors';
import { logSafe } from '../utils/logSafe';

// express 4 does not forward rejections from async handlers on its own;
// asyncHandler bridges that gap so errors reach the handler below.
// errorHandler is the single exit for every error in the system, which
// means logging policy and response shape only have one implementation.

/** Forwards an async handler's rejection into Express's next(), so it
 *  actually reaches the errorHandler below. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Unmatched route.
 *
 *  The method and path go to the log, not to the response: they're how a
 *  developer finds a typo'd client call, and they mean nothing to a user -
 *  "Route not found: GET /api/x" is a stack trace with the serial numbers
 *  filed off. The response gets one plain sentence instead. */
export const notFoundHandler = (req: Request, res: Response): void => {
  logger.warn(`Route not found: ${req.method} ${logSafe(req.originalUrl)}`);
  res.status(404).json({ message: 'The page you are looking for could not be found.' });
};

/** body-parser tags a malformed body with this type. */
const isBodyParseError = (err: unknown): err is { type: string; message: string } =>
  typeof err === 'object' &&
  err !== null &&
  (err as { type?: unknown }).type === 'entity.parse.failed';

/** The single error -> HTTP response translation layer.
 *
 *  Branch order is load-bearing, most specific first:
 *    AppError (ours, carries a status)
 *    -> UniqueConstraintError (DB unique index, semantically "already exists")
 *    -> SequelizeValidationError (model-level validation -> 421, input problem)
 *    -> body parse failure (client sent non-JSON -> 421)
 *    -> catch-all 500 (unexpected; never leak the stack to the client)
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // --- business errors we threw on purpose ---
  if (err instanceof AppError) {
    // 4xx are expected failures, warn is enough; 5xx are bugs and need
    // error + stack. This split is what keeps alerts from drowning in noise.
    // message may embed user input (e.g. the handler's name in "X is already
    // handling an open event"), so run it through logSafe - requestLogger
    // already filters URLs, this is the other injection point.
    if (err.status >= 500) {
      logger.error(`${err.name} ${err.status} ${logSafe(err.message)}`, { stack: err.stack });
    } else {
      logger.warn(`${err.name} ${err.status} ${logSafe(err.message)}`);
    }
    const body: Record<string, unknown> = { message: err.message };
    // only field-level validation errors carry details; the frontend uses
    // them to pin red text to specific inputs
    if (err.details) body.errors = err.details;
    res.status(err.status).json(body);
    return;
  }

  // --- unique index collision ---
  // reaching this means the service's pre-check didn't catch it (concurrency
  // window). Two indexes must be told apart: colliding on email is "you
  // already registered", colliding on running number is an internal
  // allocation race - the latter isn't a business error the service should
  // interpret, so it's handled here.
  if (err instanceof UniqueConstraintError) {
    // Sequelize's own message names the constraint
    // ("registrations_event_email_unique must be unique") and is therefore log
    // material only. Nothing here is a user action until it's translated.
    const first = err.errors?.[0];
    // same predicate as the service. This used to sniff errors[0].path for
    // 'emailAddress', which is always false on MySQL - that dialect reports
    // the index name instead.
    const isEmailCollision = isDuplicateEmailError(err);
    const status = HttpStatus.CLIENT_ERROR;
    const userMessage = isEmailCollision
      ? 'This email address has already registered for the event.'
      : 'This could not be saved because it clashes with something that already exists. Please check the details and try again.';
    logger.warn(
      `UniqueConstraintError ${status} ${logSafe(first?.message ?? 'unknown constraint')} -> ${logSafe(userMessage)}`,
    );
    res.status(status).json({ message: userMessage });
    return;
  }

  // --- model-level validation failure ---
  // express-validator should have caught it earlier; this usually means
  // someone bypassed the API to write directly, or a new model validator
  // was added. Still an input problem -> 421.
  // err.message is Sequelize's aggregate ("Validation error: ...") - useful in
  // the log, wrong in a response, so the response reuses the same banner the
  // validator path uses and lets the per-field details carry the specifics.
  if (err instanceof SequelizeValidationError) {
    const details = err.errors?.map((e) => ({ field: e.path, message: e.message }));
    logger.warn(`SequelizeValidationError 421 ${err.message}`);
    res
      .status(HttpStatus.VALIDATION_ERROR)
      .json({ message: INVALID_INPUT_MESSAGE, errors: details });
    return;
  }

  // --- client sent malformed JSON ---
  // thrown by express.json(); an input format issue -> 421, not 500
  if (isBodyParseError(err)) {
    logger.warn('Body parse failure 421', { detail: err.message });
    res
      .status(HttpStatus.VALIDATION_ERROR)
      .json({ message: 'The request could not be read. Please try sending it again.' });
    return;
  }

  // --- catch-all ---
  // stack goes to logs only; returning it to the client hands over a map
  // of the internals
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error(`Unhandled error 500 ${logSafe(message)}`, { stack });
  res
    .status(HttpStatus.SERVER_ERROR)
    .json({ message: 'Something went wrong on our side. Please try again in a moment.' });
};
