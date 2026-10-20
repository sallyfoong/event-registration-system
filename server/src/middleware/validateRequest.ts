import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

import { AppError, HttpStatus, INVALID_INPUT_MESSAGE } from '../utils/errors';

// express-validator only collects errors; it never aborts the request.
// Someone has to read the result and decide pass-or-fail - that's this
// middleware. Centralizing it (instead of calling validationResult in every
// route) means a forgotten call is visible as a missing segment in the
// middleware chain, rather than silently letting bad requests through.

export const validateRequest = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    next();
    return;
  }

  // field + message; the frontend uses field to target a specific input.
  // some errors aren't attached to a field (e.g. a wholly malformed body),
  // in which case 'path' in error is false, field is undefined, and the
  // frontend falls back to a top-of-form message.
  const details = errors.array().map((error) => ({
    field: 'path' in error ? error.path : undefined,
    message: error.msg,
  }));
  // The banner is what the user reads when the offending input is off-screen
  // or when several fields failed at once, so it says what to do rather than
  // what happened internally. "Validation failed" is a log line, not advice.
  next(new AppError(HttpStatus.VALIDATION_ERROR, INVALID_INPUT_MESSAGE, details));
};
