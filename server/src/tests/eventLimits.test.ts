/** Capacity ceiling (1..99999) and page ceiling (MAX_PAGE).
 *
 *  Both limits protect something outside the code's own elegance:
 *   - capacity is capped at 99999 because registration numbers are 5 digits.
 *     A capacity of 100000 would let the 100000th registration receive
 *     "100000" -- six digits -- and break the API contract on the spot.
 *   - page is capped because it is turned straight into an OFFSET; a huge
 *     page number asks the database to scan every preceding row.
 *
 *  Boundary values must remain *accepted*: an off-by-one that rejects 99999
 *  or page 1000000 would break legitimate requests while pretending to be
 *  "safe", so every limit test below is paired with its boundary success case.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler } from '../models';
import { MAX_PAGE } from '../validators/eventValidators';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const uniqueName = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createHandler = async (overrides: Partial<{ name: string; email: string }> = {}) =>
  Handler.create({
    uuid: randomUUID(),
    name: overrides.name ?? `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: overrides.email ?? `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

const eventPayload = (handlerUuid: string, overrides: Record<string, unknown> = {}) => ({
  name: uniqueName('Limits'),
  dateTime: days(10).toISOString(),
  postalCode: '123456',
  deadline: days(5).toISOString(),
  capacity: 10,
  handlerUuid,
  ...overrides,
});

const postEvent = (handlerUuid: string, overrides: Record<string, unknown> = {}) =>
  api().post('/api/admin/events').send(eventPayload(handlerUuid, overrides));

/** Seeds closed events so the handler stays free (no open-event rule conflict). */
const seedClosedEvents = async (count: number) => {
  const handler = await createHandler();
  for (let i = 0; i < count; i += 1) {
    await Event.create({
      name: uniqueName(`Paged ${i}`),
      dateTime: days(30 - i),
      deadline: days(-1 - i),
      capacity: 10,
      address: 'Singapore 123456',
      postalCode: '123456',
      handlerUuid: handler.uuid,
    } as any);
  }
  return handler;
};

const capacityErrorOf = (body: { errors?: Array<{ field?: string; message: string }> }) =>
  (body.errors ?? []).find((error) => error.field === 'capacity');

describe('POST /api/admin/events - capacity ceiling of 99999', () => {
  it('rejects capacity 100000 with 421 and explains the cap comes from 5-digit registration numbers', async () => {
    const handler = await createHandler();

    const response = await postEvent(handler.uuid, { capacity: 100000 }).expect(421);

    expect(response.body.message).toMatch(/check the highlighted fields/i);
    const capacityError = capacityErrorOf(response.body);
    expect(capacityError).toBeDefined();
    // The caller must be able to tell this apart from the empty-field message.
    expect(capacityError!.message).toMatch(/capacity/i);
    expect(capacityError!.message).toMatch(/99999/);
    expect(capacityError!.message).toMatch(/5 digits/i);
  });

  it('accepts the boundary value 99999 and persists it as a number', async () => {
    const handler = await createHandler();
    const name = uniqueName('MaxCapacity');

    await postEvent(handler.uuid, { capacity: 99999, name }).expect(200);

    const list = await api().get('/api/admin/events?search=MaxCapacity').expect(200);
    const created = (list.body.events as Array<{ name: string; capacity: number }>).find(
      (event) => event.name === name,
    );
    expect(created).toBeDefined();
    // toInt() sanitises the body, so the API must echo a number, not "99999".
    expect(created!.capacity).toBe(99999);
  });

  it('rejects capacity 0 with 421 (zero seats is not a valid event)', async () => {
    const handler = await createHandler();

    const response = await postEvent(handler.uuid, { capacity: 0 }).expect(421);

    expect(response.body.message).toMatch(/check the highlighted fields/i);
    expect(capacityErrorOf(response.body)).toBeDefined();
  });

  it('rejects negative capacity with 421', async () => {
    const handler = await createHandler();

    const response = await postEvent(handler.uuid, { capacity: -1 }).expect(421);

    const capacityError = capacityErrorOf(response.body);
    expect(capacityError).toBeDefined();
    expect(capacityError!.message).toMatch(/99999/);
  });

  it('rejects a fractional capacity with 421', async () => {
    const handler = await createHandler();

    const response = await postEvent(handler.uuid, { capacity: 1.5 }).expect(421);

    const capacityError = capacityErrorOf(response.body);
    expect(capacityError).toBeDefined();
    expect(capacityError!.message).toMatch(/whole number/i);
  });
});

describe('GET /api/admin/events - page ceiling', () => {
  it('publishes MAX_PAGE as 1,000,000 so the limit has a single source of truth', () => {
    expect(MAX_PAGE).toBe(1_000_000);
  });

  it('rejects page 2000000000 with 421 instead of letting it become a huge OFFSET', async () => {
    await seedClosedEvents(2);

    const response = await api().get('/api/admin/events?page=2000000000').expect(421);

    expect(response.body.message).toMatch(/check the highlighted fields/i);
    const pageError = (response.body.errors as Array<{ field: string; message: string }>).find(
      (error) => error.field === 'page',
    );
    expect(pageError).toBeDefined();
    expect(pageError!.message).toMatch(/1 and 1000000/);
  });

  it('rejects page 1000001, one past the boundary, with 421', async () => {
    await seedClosedEvents(2);

    const response = await api().get('/api/admin/events?page=1000001').expect(421);

    const pageError = (response.body.errors as Array<{ field: string; message: string }>).find(
      (error) => error.field === 'page',
    );
    expect(pageError).toBeDefined();
    expect(pageError!.message).toMatch(/1 and 1000000/);
  });

  it('accepts the boundary page 1000000 and returns an empty page rather than a validation error', async () => {
    await seedClosedEvents(2);

    const response = await api().get('/api/admin/events?page=1000000').expect(200);

    // Being past the last page is a normal, empty result -- not a 421.
    expect(response.body.total).toBe(2);
    expect(response.body.events).toEqual([]);
  });

  it('rejects page 0 with 421', async () => {
    const response = await api().get('/api/admin/events?page=0').expect(421);
    expect(response.body.message).toMatch(/check the highlighted fields/i);
  });

  it('rejects a non-numeric page with 421', async () => {
    const response = await api().get('/api/admin/events?page=abc').expect(421);
    const pageError = (response.body.errors as Array<{ field: string; message: string }>).find(
      (error) => error.field === 'page',
    );
    expect(pageError).toBeDefined();
  });

  it('defaults to the first page when page is omitted', async () => {
    await seedClosedEvents(2);

    const response = await api().get('/api/admin/events').expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.events).toHaveLength(2);
  });
});
