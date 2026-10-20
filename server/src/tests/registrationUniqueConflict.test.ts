// A unique constraint violation shaped the way MySQL reports it.
//
// The suite runs on SQLite, where a duplicate email comes back with the
// column names in `fields`: ['eventUuid', 'emailAddress']. MySQL reports
// the index name instead - { registrations_event_email_unique: '...' } -
// because the index is declared in the model's options.indexes and
// Sequelize can't map it back to columns.
//
// So on SQLite this code path never runs. Without hand-building the MySQL
// shape here, "a duplicate email on MySQL is treated as a number collision,
// retried five times and answered with a 500" stays invisible to the suite.

import { UniqueConstraintError, ValidationErrorItem } from 'sequelize';
import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import {
  Event,
  Handler,
  isDuplicateEmailError,
  Registration,
  REGISTRATION_EMAIL_INDEX,
} from '../models';

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const createOpenEvent = async () => {
  const handler = await Handler.create({
    uuid: randomUUID(),
    name: `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });
  return Event.create({
    name: `Conflict ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dateTime: days(20),
    deadline: days(5),
    capacity: 10,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid: handler.uuid,
  } as any);
};

/** Build the error the MySQL dialect's formatError would produce: the key
 *  of `fields` is the index name, `errors[0].path` is the index name too, and
 *  the message is "Validation error". */
const mysqlUniqueError = (indexName: string) =>
  new UniqueConstraintError({
    message: 'Validation error',
    fields: { [indexName]: 'x' },
    errors: [
      new ValidationErrorItem(
        `${indexName} must be unique`,
        'unique violation',
        indexName,
        'x',
        null as any,
        'not_unique',
        '',
        [],
      ),
    ],
    parent: { sql: '', name: 'SequelizeUniqueConstraintError', message: 'Duplicate entry' } as any,
  });

const register = (eventUuid: string, emailAddress: string) =>
  request(app).post('/api/public/register').send({ eventUuid, emailAddress });

describe('unique violation classification (MySQL shape)', () => {
  it('returns false for anything that is not a unique violation', () => {
    // Guard: the error handler calls this, and anything can arrive there
    expect(isDuplicateEmailError(new Error('boom'))).toBe(false);
  });

  it('treats an email-index collision as "already registered" (400), not as a number-allocation failure (500)', async () => {
    const event = await createOpenEvent();
    // The pre-check misses it (concurrent window); the insert hits the
    // email index instead
    const createSpy = jest
      .spyOn(Registration, 'create')
      .mockRejectedValue(mysqlUniqueError(REGISTRATION_EMAIL_INDEX));

    try {
      const response = await register(event.uuid, 'dup@example.com');
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'This email address has already registered for the event.',
      );
      // A duplicate email isn't our fault, so it must not be retried
      expect(createSpy).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });

  it('does not mistake a running-number collision for a duplicate email', async () => {
    const event = await createOpenEvent();
    const createSpy = jest
      .spyOn(Registration, 'create')
      .mockRejectedValue(mysqlUniqueError('registrations_event_no_unique'));

    try {
      const response = await register(event.uuid, 'fresh@example.com');
      // Number allocation retried five times and still failing -> 500, and
      // the message must not claim the email is already registered
      expect(response.status).toBe(500);
      expect(response.body.message).not.toMatch(/already registered/i);
      expect(createSpy).toHaveBeenCalledTimes(5);
    } finally {
      createSpy.mockRestore();
    }
  });
});
