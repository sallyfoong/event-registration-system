/** Registration rules for POST /api/public/register.
 *
 *  Two behaviours that look like details but are contract-level:
 *  1. The duplicate-email check runs BEFORE the capacity/deadline check.
 *     Someone who already registered must be told "already registered",
 *     never "full capacity" -- the latter makes them think the first attempt
 *     failed and that they are not on the list.
 *  2. Emails are stored in their normalised (trimmed, lower-cased) form, so
 *     "Pad@Example.COM" and "pad@example.com" are the same person. Without
 *     this the unique index would let two rows exist for one human.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler, Registration } from '../models';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const uniqueName = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createHandler = async () =>
  Handler.create({
    uuid: randomUUID(),
    name: `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

const createEvent = async (overrides: Partial<{ deadline: Date; capacity: number }> = {}) => {
  const handler = await createHandler();
  return Event.create({
    name: uniqueName('Registration'),
    dateTime: days(20),
    deadline: overrides.deadline ?? days(5),
    capacity: overrides.capacity ?? 10,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid: handler.uuid,
  } as any);
};

const register = (eventUuid: string, emailAddress: string) =>
  api().post('/api/public/register').send({ eventUuid, emailAddress });

describe('POST /api/public/register - duplicate check precedes capacity and deadline', () => {
  it('answers "already registered" before "full capacity" on a capacity-1 event', async () => {
    const event = await createEvent({ capacity: 1, deadline: days(5) });

    const first = await register(event.uuid, 'first@example.com').expect(200);
    expect(first.body.registrationNo).toBe('00001');

    // Same email again: the event is now full too, but the user must be told
    // about the duplicate, otherwise they believe they are not registered.
    const duplicate = await register(event.uuid, 'first@example.com').expect(400);
    expect(duplicate.body.message).toMatch(/already registered/i);
    expect(duplicate.body.message).not.toMatch(/capacity/i);

    // A different email gets the capacity message -- the two errors stay distinct.
    const full = await register(event.uuid, 'second@example.com').expect(400);
    expect(full.body.message).toMatch(/full capacity/i);
    expect(full.body.message).not.toMatch(/already registered/i);
  });

  it('answers "already registered" before "deadline has passed" on a closed event', async () => {
    const event = await createEvent({ deadline: days(-1) });
    // Written directly: the API would refuse to register anyone on a closed event.
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'early@example.com',
      registrationNo: '00001',
    });

    const duplicate = await register(event.uuid, 'early@example.com').expect(400);
    expect(duplicate.body.message).toMatch(/already registered/i);
    expect(duplicate.body.message).not.toMatch(/deadline/i);

    const closed = await register(event.uuid, 'newcomer@example.com').expect(400);
    expect(closed.body.message).toMatch(/deadline has passed/i);
  });
});

describe('POST /api/public/register - concurrent duplicate fallback', () => {
  it('still answers "already registered" when the unique index, not the pre-check, catches the duplicate', async () => {
    const event = await createEvent({ deadline: days(5), capacity: 10 });
    await register(event.uuid, 'race@example.com').expect(200);

    // The window two concurrent requests can slip through: the pre-check sees
    // nothing, then the insert hits the (eventUuid, emailAddress) unique index.
    // Mocking findOne to null is the only way to reach that catch branch.
    const findOneSpy = jest
      .spyOn(Registration, 'findOne')
      .mockResolvedValue(null as unknown as Registration);
    try {
      const response = await register(event.uuid, 'race@example.com').expect(400);
      // A 500 here would be a self-inflicted error: it is the caller's duplicate.
      expect(response.body.message).toMatch(/already registered/i);
    } finally {
      findOneSpy.mockRestore();
    }

    expect(await Registration.count({ where: { eventUuid: event.uuid } })).toBe(1);
  });
});

describe('POST /api/public/register - email normalisation', () => {
  it('accepts a padded, mixed-case address and stores it trimmed and lower-cased', async () => {
    const event = await createEvent({ deadline: days(5) });

    const response = await register(event.uuid, '  Pad@Example.COM  ').expect(200);

    expect(response.body.registrationNo).toMatch(/^\d{5}$/);
    const stored = await Registration.findAll({ where: { eventUuid: event.uuid } });
    expect(stored).toHaveLength(1);
    expect(stored[0].emailAddress).toBe('pad@example.com');
  });

  it('treats different casings of one address as the same person', async () => {
    const event = await createEvent({ deadline: days(5) });

    await register(event.uuid, 'pad@example.com').expect(200);
    const upper = await register(event.uuid, 'PAD@EXAMPLE.COM').expect(400);

    expect(upper.body.message).toMatch(/already registered/i);
    // One human, one row: the unique index must see the same value both times.
    expect(await Registration.count({ where: { eventUuid: event.uuid } })).toBe(1);
  });
});
