/** Business rules for POST /api/admin/events that live in the service layer.
 *
 *  Two rules are covered here:
 *  1. The event name must be unique (the brief says so explicitly). The
 *     duplicate message has to be identical whether the pre-check (findOne) or
 *     the unique index (concurrent insert) catches it - two wordings for one
 *     error means the frontend cannot rely on `message`.
 *  2. A handler may hold at most ONE *open* event at a time. "Open" means
 *     "deadline in the future AND seats left", so a handler whose event is
 *     already full or already past its deadline is free to take a new one.
 *     That distinction is the easiest part of the rule to get wrong.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler, Registration } from '../models';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const uniqueName = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createHandler = async (overrides: Partial<{ name: string }> = {}) =>
  Handler.create({
    uuid: randomUUID(),
    name: overrides.name ?? `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

const createEvent = async (
  handlerUuid: string,
  overrides: Partial<{ name: string; deadline: Date; capacity: number }> = {},
) =>
  Event.create({
    name: overrides.name ?? uniqueName('Rule'),
    dateTime: days(20),
    deadline: overrides.deadline ?? days(5),
    capacity: overrides.capacity ?? 10,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid,
  } as any);

const eventPayload = (handlerUuid: string, overrides: Record<string, unknown> = {}) => ({
  name: uniqueName('Rule New'),
  dateTime: days(30).toISOString(),
  postalCode: '123456',
  deadline: days(25).toISOString(),
  capacity: 10,
  handlerUuid,
  ...overrides,
});

const postEvent = (handlerUuid: string, overrides: Record<string, unknown> = {}) =>
  api().post('/api/admin/events').send(eventPayload(handlerUuid, overrides));

describe('POST /api/admin/events - the event name must be unique', () => {
  const DUPLICATE_NAME = 'Contract Expo 2026';
  const expectedMessage = 'An event with this name already exists. Please choose a different name.';

  it('rejects a duplicate name with 400 and the contract message', async () => {
    const first = await createHandler();
    const second = await createHandler();
    await createEvent(first.uuid, { name: DUPLICATE_NAME });

    const response = await postEvent(second.uuid, { name: DUPLICATE_NAME }).expect(400);

    expect(response.body.message).toBe(expectedMessage);
    // Nothing was written: the second attempt left exactly one row behind.
    expect(await Event.count({ where: { name: DUPLICATE_NAME } })).toBe(1);
  });

  it('returns the same message when the unique index, not the pre-check, catches it', async () => {
    // The pre-check saw nothing and the insert then hit the unique index --
    // exactly what happens when two requests pass the check concurrently.
    // Mocking findOne to null is the only way to reach that catch branch.
    const owner = await createHandler();
    const racer = await createHandler();
    // Owned by a different handler with a past deadline, so the open-event
    // rule cannot fire first and mask the branch under test.
    await createEvent(owner.uuid, { name: DUPLICATE_NAME, deadline: days(-1) });

    const findOneSpy = jest.spyOn(Event, 'findOne').mockResolvedValue(null as unknown as Event);
    try {
      const response = await postEvent(racer.uuid, { name: DUPLICATE_NAME }).expect(400);
      expect(response.body.message).toBe(expectedMessage);
    } finally {
      findOneSpy.mockRestore();
    }

    // Nothing was written, so the original row is still the only one.
    expect(await Event.count({ where: { name: DUPLICATE_NAME } })).toBe(1);
  });
});

describe('POST /api/admin/events - at most one open event per handler', () => {
  it('rejects a second open event for the same handler with 400 naming the handler', async () => {
    const handler = await createHandler({ name: 'Overloaded Olivia' });
    await createEvent(handler.uuid, { deadline: days(5), capacity: 50 });

    const response = await postEvent(handler.uuid).expect(400);

    expect(response.body.message).toMatch(/already handling an open event/i);
    expect(response.body.message).toContain('Overloaded Olivia');
  });

  it('allows a new open event when the handler previous event is already full', async () => {
    // A full event is no longer open, so the handler has a free slot.
    const handler = await createHandler();
    const full = await createEvent(handler.uuid, { deadline: days(5), capacity: 1 });
    await Registration.create({
      eventUuid: full.uuid,
      emailAddress: 'seat-taken@example.com',
      registrationNo: '00001',
    });

    const name = uniqueName('AfterFull');
    await postEvent(handler.uuid, { name }).expect(200);

    const list = await api().get('/api/admin/events?search=AfterFull').expect(200);
    expect((list.body.events as Array<{ name: string }>).some((event) => event.name === name)).toBe(
      true,
    );
  });

  it('allows a new open event when the handler previous event deadline has passed', async () => {
    const handler = await createHandler();
    await createEvent(handler.uuid, { deadline: days(-1), capacity: 10 });

    const name = uniqueName('AfterDeadline');
    await postEvent(handler.uuid, { name }).expect(200);

    const list = await api().get('/api/admin/events?search=AfterDeadline').expect(200);
    expect((list.body.events as Array<{ name: string }>).some((event) => event.name === name)).toBe(
      true,
    );
  });

  it('lets two different handlers each create an open event', async () => {
    const alice = await createHandler({ name: 'Alice' });
    const bob = await createHandler({ name: 'Bob' });

    await postEvent(alice.uuid).expect(200);
    await postEvent(bob.uuid).expect(200);
  });

  it('rejects an unknown handlerUuid with 400', async () => {
    const response = await postEvent('00000000-0000-4000-8000-000000000000').expect(400);

    expect(response.body.message).toMatch(/handler could not be found/i);
  });
});
