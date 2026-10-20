// Status codes are defined in one place so a service never has to remember
// that validation failures are 421 and not 422. The client branches on the
// code, so a typo'd number turns into "the form failed but the page said
// nothing".

/** A business error that carries its own HTTP status.
 *  Thrown by the services, caught by the error handler, which decides how it
 *  gets logged and serialised. The services never touch `res`, which is what
 *  makes them testable without a request. */
export class AppError extends Error {
  public readonly status: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    // 4xx is a failure we expected (bad input, rule not met) and deserves a
    // warning; 5xx means we have a bug and needs error level plus a stack.
    // That distinction is the whole reason this field exists.
    this.isOperational = status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const HttpStatus = {
  OK: 200,
  VALIDATION_ERROR: 421,
  CLIENT_ERROR: 400,
  SERVER_ERROR: 500,
} as const;

/** The banner shown above a form when one or more inputs were rejected.
 *
 *  Two different validation paths reach the user through the same form: the
 *  express-validator chains (middleware/validateRequest) and Sequelize's
 *  model validators (middleware/errorHandler). They must produce the same
 *  sentence, otherwise the identical mistake - an empty name, say - looks like
 *  two unrelated problems depending on which layer happened to catch it.
 *  Defined once here for exactly that reason. */
export const INVALID_INPUT_MESSAGE =
  'Some of the information you entered is not valid. Please check the highlighted fields and try again.';

/** The request was fine, the current state doesn't allow it: a handler that
 *  already runs an open event, a registration deadline that has passed, a full
 *  event, an event that doesn't exist. */
export const clientError = (message: string, details?: unknown): AppError =>
  new AppError(HttpStatus.CLIENT_ERROR, message, details);

export const serverError = (message: string, details?: unknown): AppError =>
  new AppError(HttpStatus.SERVER_ERROR, message, details);
