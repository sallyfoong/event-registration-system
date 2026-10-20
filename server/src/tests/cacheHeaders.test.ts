/** The cache as observed from outside: X-Cache headers and invalidation.
 *
 *  cache.test.ts proves the module works; this suite proves the wiring does.
 *  Those are different failures - a correct cache that nobody reads from, or
 *  one that is never invalidated after a write, looks perfect in a unit test
 *  and still serves yesterday's numbers in the browser.
 *
 *  The TTL is raised for this file only (the default is 0 under NODE_ENV=test,
 *  see config/env.ts). Each case clears the store first, because entries would
 *  otherwise survive from the previous case and turn every "MISS" into a
 *  "HIT".
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { env } from '../config/env';
import { clear as clearCache } from '../utils/cache';
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

const createEvent = async (handlerUuid: string, name: string) =>
  Event.create({
    name,
    dateTime: days(20),
    deadline: days(5),
    capacity: 10,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid,
  } as any);

describe('read-through cache over HTTP', () => {
  const originalTtl = env.cacheTtlMs;

  beforeAll(() => {
    env.cacheTtlMs = 60_000;
  });

  afterAll(() => {
    env.cacheTtlMs = originalTtl;
  });

  beforeEach(() => {
    clearCache();
  });

  it('reports MISS then HIT, and the body is identical both times', async () => {
    await createEvent((await createHandler()).uuid, uniqueName('Cached'));

    const first = await api().get('/api/public/events').expect(200);
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await api().get('/api/public/events').expect(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toEqual(first.body);
  });

  it('keeps each filter combination in its own entry', async () => {
    const handler = await createHandler();
    await createEvent(handler.uuid, 'Alpha Summit');
    await createEvent(handler.uuid, 'Beta Summit');

    const alpha = await api().get('/api/admin/events?search=Alpha').expect(200);
    expect(alpha.headers['x-cache']).toBe('MISS');
    expect(alpha.body.total).toBe(1);

    // A key built from `page` alone would answer this from the Alpha entry.
    const beta = await api().get('/api/admin/events?search=Beta').expect(200);
    expect(beta.headers['x-cache']).toBe('MISS');
    expect(beta.body.total).toBe(1);
    expect((beta.body.events as Array<{ name: string }>)[0].name).toBe('Beta Summit');

    // ...and the first key is still served from memory.
    expect((await api().get('/api/admin/events?search=Alpha').expect(200)).headers['x-cache']).toBe(
      'HIT',
    );
  });

  it('does not let a cached list hide a newly created event', async () => {
    const handler = await createHandler();
    await api().get('/api/admin/events').expect(200); // warm the cache

    const name = uniqueName('Freshly Created');
    await api()
      .post('/api/admin/events')
      .send({
        name,
        dateTime: days(10).toISOString(),
        postalCode: '123456',
        deadline: days(5).toISOString(),
        capacity: 10,
        handlerUuid: handler.uuid,
      })
      .expect(200);

    const afterCreate = await api().get('/api/admin/events').expect(200);
    expect(afterCreate.headers['x-cache']).toBe('MISS');
    expect((afterCreate.body.events as Array<{ name: string }>).map((e) => e.name)).toContain(name);
  });

  it('drops the cached reads when a registration changes the count', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, uniqueName('Counting'));

    const before = await api().get('/api/admin/events').expect(200);
    expect(
      (before.body.events as Array<{ uuid: string; registrationCount: number }>).find(
        (e) => e.uuid === event.uuid,
      )?.registrationCount,
    ).toBe(0);

    await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'counter@example.com' })
      .expect(200);

    const after = await api().get('/api/admin/events').expect(200);
    expect(after.headers['x-cache']).toBe('MISS');
    expect(
      (after.body.events as Array<{ uuid: string; registrationCount: number }>).find(
        (e) => e.uuid === event.uuid,
      )?.registrationCount,
    ).toBe(1);
  });

  it('caches the detail and trend endpoints per uuid', async () => {
    const handler = await createHandler();
    const first = await createEvent(handler.uuid, uniqueName('Detail A'));
    const second = await createEvent(handler.uuid, uniqueName('Detail B'));

    expect(
      (await api().get(`/api/admin/events/${first.uuid}`).expect(200)).headers['x-cache'],
    ).toBe('MISS');
    const secondRead = await api().get(`/api/admin/events/${first.uuid}`).expect(200);
    expect(secondRead.headers['x-cache']).toBe('HIT');
    expect(secondRead.body.uuid).toBe(first.uuid);

    // A different uuid must not be served from the first one's entry.
    const otherDetail = await api().get(`/api/admin/events/${second.uuid}`).expect(200);
    expect(otherDetail.headers['x-cache']).toBe('MISS');
    expect(otherDetail.body.uuid).toBe(second.uuid);

    expect(
      (await api().post(`/api/admin/events/${first.uuid}/trend`).expect(200)).headers['x-cache'],
    ).toBe('MISS');
    expect(
      (await api().post(`/api/admin/events/${first.uuid}/trend`).expect(200)).headers['x-cache'],
    ).toBe('HIT');
  });
});
