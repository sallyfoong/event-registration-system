import fs from 'fs';
import path from 'path';
import winston from 'winston';

import { env } from './env';
import { currentRequestId } from '../utils/requestContext';

// logform is a transitive dependency of winston, so its types are reached
// through winston's own namespace rather than a separate import.
type TransformableInfo = winston.Logform.TransformableInfo;

// console output is for humans (colors, timestamps, wrapped stacks);
// file output is JSON for machines, ready to pipe into ELK / Loki later.
// File transports are skipped under test so a few test runs don't fill
// logs/ with noise.

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/** Stamp the current request's id onto every log record.
 *
 *  This is the whole reason the request id is worth having: a log line
 *  written six calls deep inside the registration service is useless for
 *  triage unless it can be tied back to the submission that caused it. Doing
 *  it as a format means no call site has to remember to pass an id - which is
 *  exactly the line you'd forget on the day it mattered.
 *
 *  Outside a request (startup, the seed script) there is no id and the field
 *  is simply absent. */
const withRequestId = winston.format((info: TransformableInfo) => {
  const requestId = currentRequestId();
  if (requestId) {
    (info as TransformableInfo & { requestId?: string }).requestId = requestId;
  }
  return info;
});

const consoleFormat = printf((info) => {
  const {
    level,
    message,
    timestamp: ts,
    stack,
    requestId,
  } = info as TransformableInfo & {
    requestId?: string;
  };
  // bracket the id so it can be copied out of a terminal with one selection
  const tag = requestId ? ` [${requestId}]` : '';
  return `${ts} [${level}]${tag} ${message}${stack ? `\n${stack}` : ''}`;
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(
      withRequestId(),
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      consoleFormat,
    ),
  }),
];

if (!env.isTest) {
  // create the directory on demand so the first boot doesn't crash on a
  // missing logs/
  const logsDir = path.resolve(__dirname, '../../logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  transports.push(
    // error.log gets error+ only; combined.log gets everything. Two files
    // so incident triage starts at error.log without wading through info.
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: combine(withRequestId(), timestamp(), errors({ stack: true }), json()),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: combine(withRequestId(), timestamp(), errors({ stack: true }), json()),
    }),
  );
}

export const logger = winston.createLogger({
  level: env.logLevel,
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true })),
  transports,
  // a broken logger must not take the process down - failing to write a log
  // line is never a reason for the service to die
  exitOnError: false,
});

/** Exported for the unit test: the format is the only place the request id
 *  reaches a log record, so it is worth asserting on directly rather than
 *  through a transport. */
export { withRequestId };
