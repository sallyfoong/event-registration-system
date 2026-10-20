/** API contract snapshots.
 *
 *  The documented contract pins down the exact response body for every
 *  endpoint and the checks are automated, so "extra fields are harmless" is
 *  false here: adding one is a contract break. Every assertion below compares
 *  the FULL sorted key set rather than checking that a field exists, so an
 *  added or renamed field fails the test instead of sliding through.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler } from '../models';

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

const createEvent = async (
  handlerUuid: string,
  overrides: Partial<{ name: string; deadline: Date; capacity: number }> = {},
) =>
  Event.create({
    name: overrides.name ?? uniqueName('Contract'),
    dateTime: days(20),
    deadline: overrides.deadline ?? days(5),
    capacity: overrides.capacity ?? 10,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid,
  } as any);

const sortedKeys = (value: object) => Object.keys(value).sort();

describe('GET /api/admin/events - response contract', () => {
  it('returns exactly { total, events[] } with exactly the specified event fields', async () => {
    const handler = await createHandler();
    await createEvent(handler.uuid, { deadline: days(5) });

    const response = await api().get('/api/admin/events').expect(200);

    expect(sortedKeys(response.body)).toEqual(['events', 'total']);
    expect(typeof response.body.total).toBe('number');
    expect(Array.isArray(response.body.events)).toBe(true);
    expect(response.body.events).toHaveLength(1);

    const event = response.body.events[0];
    expect(sortedKeys(event)).toEqual(
      [
        'uuid',
        'createdAt',
        'name',
        'dateTime',
        'address',
        'deadline',
        'capacity',
        'registrationCount',
        'handler',
      ].sort(),
    );
    expect(sortedKeys(event.handler)).toEqual(['uuid', 'name'].sort());
    expect(event.handler.uuid).toBe(handler.uuid);
    expect(event.handler.name).toBe(handler.name);
    expect(typeof event.capacity).toBe('number');
    expect(typeof event.registrationCount).toBe('number');
  });
});

describe('GET /api/public/events - response contract', () => {
  it('returns a bare array whose items carry exactly the five public fields', async () => {
    const handler = await createHandler();
    await createEvent(handler.uuid, { deadline: days(5), capacity: 10 });

    const response = await api().get('/api/public/events').expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);

    const event = response.body[0];
    expect(sortedKeys(event)).toEqual(['uuid', 'name', 'dateTime', 'address', 'deadline'].sort());
    // Public callers must not learn the handler, the capacity or the headcount.
    expect(event).not.toHaveProperty('capacity');
    expect(event).not.toHaveProperty('handler');
    expect(event).not.toHaveProperty('registrationCount');
  });
});

describe('POST /api/public/register - response contract', () => {
  it('returns exactly { registrationNo } as a 5-digit string', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(5), capacity: 10 });

    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'contract@example.com' })
      .expect(200);

    expect(sortedKeys(response.body)).toEqual(['registrationNo']);
    // Regex, not length: "1234a" and " 0001" are both five characters long.
    expect(response.body.registrationNo).toMatch(/^\d{5}$/);
  });
});

describe('POST /api/admin/events/:uuid/trend - response contract', () => {
  it('returns an array of exactly { date, registrationCount, newRegistrationCount } rows', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(3), capacity: 10 });

    const response = await api().post(`/api/admin/events/${event.uuid}/trend`).expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);

    for (const row of response.body) {
      expect(sortedKeys(row)).toEqual(['date', 'registrationCount', 'newRegistrationCount'].sort());
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.registrationCount).toBe('number');
      expect(typeof row.newRegistrationCount).toBe('number');
    }
  });
});

describe('POST /api/admin/events - response contract', () => {
  it('returns a null body (the spec says nil)', async () => {
    const handler = await createHandler();

    const response = await api()
      .post('/api/admin/events')
      .send({
        name: uniqueName('Contract Create'),
        dateTime: days(10).toISOString(),
        postalCode: '123456',
        deadline: days(5).toISOString(),
        capacity: 10,
        handlerUuid: handler.uuid,
      })
      .expect(200);

    expect(response.body).toBeNull();
  });
});

describe('status codes - a success is 200, never 304', () => {
  it('answers a conditional request with 200 and a full body', async () => {
    const first = await api().get('/api/public/events').expect(200);

    // Express's default ETag is off (see app.ts). It would answer a repeat
    // GET carrying If-None-Match with 304, which is not one of the four
    // statuses the brief defines and carries no body for a checker to read.
    expect(first.headers.etag).toBeUndefined();

    // What a browser that cached a response from an older build sends. With
    // no ETag on this response there is nothing to match, so the answer has
    // to be 200 with a body. (If-None-Match: * is not used here on purpose:
    // Node treats it as "give me 304 if anything exists" regardless of ETag,
    // which is correct HTTP but not the case being protected against.)
    const conditional = await api()
      .get('/api/public/events')
      .set('If-None-Match', 'W/"1a2b3c-stale-from-an-older-build"')
      .expect(200);
    expect(conditional.body).toEqual(first.body);
  });
});

describe('error responses - contract', () => {
  it('returns 421 rather than 500 when the body is not valid JSON', async () => {
    // A client-side syntax error is an input problem (421), not our failure.
    const response = await api()
      .post('/api/admin/events')
      .set('Content-Type', 'application/json')
      .send('{"name": "broken"');

    expect(response.status).toBe(421);
    expect(response.body).toEqual({
      message: 'The request could not be read. Please try sending it again.',
    });
  });
});
