import request from 'supertest';
import { randomUUID } from 'crypto';
import { Op } from 'sequelize';

import app from '../app';
import { Event, Handler, Registration } from '../models';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const uniqueName = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createHandler = async (
  overrides: Partial<{ name: string; email: string; uuid?: string }> = {},
) => {
  return Handler.create({
    uuid: overrides.uuid ?? randomUUID(),
    name: overrides.name ?? `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: overrides.email ?? `handler${Math.random().toString(36).slice(2, 6)}@company.com`,
  });
};

const createEvent = async (
  handlerUuid: string,
  overrides: Partial<{
    name: string;
    dateTime: Date;
    deadline: Date;
    capacity: number;
    address: string;
    postalCode: string;
    createdAt: Date;
  }> = {},
) =>
  Event.create({
    name: overrides.name ?? uniqueName('Event'),
    dateTime: overrides.dateTime ?? days(7),
    deadline: overrides.deadline ?? days(5),
    capacity: overrides.capacity ?? 10,
    address: overrides.address ?? 'Singapore 123456',
    postalCode: overrides.postalCode ?? '123456',
    handlerUuid,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  } as any);

describe('GET /api/admin/events', () => {
  it('returns paginated events with the expected shape and ordering', async () => {
    const handler = await createHandler({ name: 'Alice Tan' });
    for (let i = 0; i < 12; i += 1) {
      // Past deadlines so the handler can host many closed events.
      await createEvent(handler.uuid, {
        name: uniqueName(`Event ${i}`),
        dateTime: days(30 - i),
        deadline: days(-1 - i),
      });
    }

    const page1 = await api().get('/api/admin/events?page=1').expect(200);
    expect(page1.body.total).toBe(12);
    expect(page1.body.events).toHaveLength(10);

    const first = page1.body.events[0];
    expect(Object.keys(first).sort()).toEqual(
      [
        'address',
        'capacity',
        'createdAt',
        'dateTime',
        'deadline',
        'handler',
        'name',
        'registrationCount',
        'uuid',
      ].sort(),
    );
    expect(Object.keys(first.handler).sort()).toEqual(['name', 'uuid']);
    expect(typeof first.registrationCount).toBe('number');
    expect(typeof first.createdAt).toBe('string');
    expect(new Date(first.dateTime).toString()).not.toBe('Invalid Date');

    const page2 = await api().get('/api/admin/events?page=2').expect(200);
    expect(page2.body.events).toHaveLength(2);
    expect(page2.body.total).toBe(12);

    const page3 = await api().get('/api/admin/events?page=3').expect(200);
    expect(page3.body.events).toHaveLength(0);
    expect(page3.body.total).toBe(12);
  });

  it('searches across event name, address and handler name (partial words)', async () => {
    const alice = await createHandler({ name: 'Alice Tan' });
    const bob = await createHandler({ name: 'Bob Lim' });

    await createEvent(alice.uuid, { name: 'Tech Summit 2026', address: 'Orchard Road' });
    await createEvent(bob.uuid, { name: 'Career Fair', address: 'Marina Bay Sands' });

    expect((await api().get('/api/admin/events?search=tech').expect(200)).body.total).toBe(1);
    expect((await api().get('/api/admin/events?search=ORCHARD').expect(200)).body.total).toBe(1);
    expect((await api().get('/api/admin/events?search=alice').expect(200)).body.total).toBe(1);
    expect((await api().get('/api/admin/events?search=marina').expect(200)).body.total).toBe(1);
    expect((await api().get('/api/admin/events?search=nomatch').expect(200)).body.total).toBe(0);
  });

  it('filters open=true to events that have not reached their deadline or capacity', async () => {
    const handler = await createHandler();
    const open = await createEvent(handler.uuid, { deadline: days(5), capacity: 10 });
    const pastDeadline = await createEvent(handler.uuid, { deadline: days(-1), capacity: 10 });
    const full = await createEvent(handler.uuid, { deadline: days(5), capacity: 1 });
    await Registration.create({
      eventUuid: full.uuid,
      emailAddress: 'full@x.com',
      registrationNo: '00001',
    });

    const response = await api().get('/api/admin/events?open=true').expect(200);
    const ids = response.body.events.map((e: { uuid: string }) => e.uuid);
    expect(ids).toContain(open.uuid);
    expect(ids).not.toContain(pastDeadline.uuid);
    expect(ids).not.toContain(full.uuid);
  });

  it('returns a 421 validation error for malformed pagination/open params', async () => {
    const bad = await api().get('/api/admin/events?page=0').expect(421);
    expect(bad.body.message).toMatch(/check the highlighted fields/i);
    expect(Array.isArray(bad.body.errors)).toBe(true);

    const badOpen = await api().get('/api/admin/events?open=yes').expect(421);
    expect(badOpen.body.message).toMatch(/check the highlighted fields/i);
  });

  it('accepts open=1 as an alias for open=true and rejects open=false with actionable guidance', async () => {
    const handler = await createHandler();
    const openEvent = await createEvent(handler.uuid, { deadline: days(5) });
    await createEvent(handler.uuid, { name: `Closed ${randomUUID()}`, deadline: days(-1) });

    const viaOne = await api().get('/api/admin/events?open=1').expect(200);
    expect((viaOne.body.events as Array<{ uuid: string }>).map((e) => e.uuid)).toContain(
      openEvent.uuid,
    );

    const viaTrue = await api().get('/api/admin/events?open=true').expect(200);
    expect(viaTrue.body.total).toBe(viaOne.body.total);

    // The spec only defines open=true. Any other explicit value is rejected,
    // and the message must tell the caller how to get all events instead.
    const rejected = await api().get('/api/admin/events?open=false').expect(421);
    expect(rejected.body.errors[0].message).toMatch(/leave it out/i);

    // Omitting the parameter lists every event regardless of open state.
    const all = await api().get('/api/admin/events').expect(200);
    expect(all.body.total).toBeGreaterThan(viaTrue.body.total);
  });

  it('populates registrationCount accurately', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(2) });
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'a@x.com',
      registrationNo: '00001',
    });
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'b@x.com',
      registrationNo: '00002',
    });

    const response = await api().get('/api/admin/events').expect(200);
    const target = response.body.events.find((e: { uuid: string }) => e.uuid === event.uuid);
    expect(target.registrationCount).toBe(2);
  });
});

describe('POST /api/admin/events', () => {
  it('creates an event and returns 200 with null body', async () => {
    const handler = await createHandler();
    const payload = {
      name: uniqueName('Created'),
      dateTime: days(10).toISOString(),
      postalCode: '123456',
      deadline: days(5).toISOString(),
      capacity: 100,
      handlerUuid: handler.uuid,
    };

    const response = await api().post('/api/admin/events').send(payload).expect(200);
    expect(response.body).toBeNull();

    const list = await api().get('/api/admin/events').expect(200);
    expect(list.body.events.find((e: { name: string }) => e.name === payload.name)).toBeDefined();
  });

  it('returns 421 with field details on validation failures', async () => {
    const handler = await createHandler();
    const cases: Array<{ overrides: Record<string, unknown>; field: string }> = [
      { overrides: { name: '' }, field: 'name' },
      { overrides: { dateTime: 'not-a-date' }, field: 'dateTime' },
      { overrides: { deadline: '' }, field: 'deadline' },
      { overrides: { postalCode: '12345' }, field: 'postalCode' },
      { overrides: { capacity: 0 }, field: 'capacity' },
      { overrides: { handlerUuid: 'not-a-uuid' }, field: 'handlerUuid' },
    ];

    for (const { overrides, field } of cases) {
      const payload = {
        name: uniqueName('Validation'),
        dateTime: days(10).toISOString(),
        postalCode: '123456',
        deadline: days(5).toISOString(),
        capacity: 100,
        handlerUuid: handler.uuid,
        ...overrides,
      };
      const response = await api().post('/api/admin/events').send(payload).expect(421);
      expect(response.body.message).toMatch(/check the highlighted fields/i);
      const fields = (response.body.errors as Array<{ field: string }>).map((e) => e.field);
      expect(fields).toContain(field);
    }
  });

  it('rejects a deadline that is not earlier than the event date with 400', async () => {
    const handler = await createHandler();
    const base = {
      name: uniqueName('DeadlineOrder'),
      postalCode: '123456',
      capacity: 10,
      handlerUuid: handler.uuid,
    };

    // deadline after dateTime
    const late = await api()
      .post('/api/admin/events')
      .send({ ...base, dateTime: days(10).toISOString(), deadline: days(12).toISOString() })
      .expect(400);
    expect(late.body.message).toMatch(/earlier than the event start time/i);

    // deadline exactly equal to dateTime is still invalid (registration must close first)
    const same = new Date(days(10).toISOString());
    await api()
      .post('/api/admin/events')
      .send({ ...base, dateTime: same.toISOString(), deadline: same.toISOString() })
      .expect(400);

    // correct ordering is accepted
    await api()
      .post('/api/admin/events')
      .send({ ...base, dateTime: days(10).toISOString(), deadline: days(9).toISOString() })
      .expect(200);
  });

  it('rejects a second event with an existing name', async () => {
    const handler = await createHandler();
    const other = await createHandler();
    const payload = {
      name: 'Duplicate Name',
      dateTime: days(10).toISOString(),
      postalCode: '123456',
      deadline: days(5).toISOString(),
      capacity: 10,
      handlerUuid: handler.uuid,
    };
    await api().post('/api/admin/events').send(payload).expect(200);
    // A different handler, so the only rule that can reject this is the name -
    // "one open event per handler" must not be the reason it fails.
    const second = await api()
      .post('/api/admin/events')
      .send({ ...payload, handlerUuid: other.uuid })
      .expect(400);
    expect(second.body.message).toMatch(/already exists/i);

    expect(await Event.count({ where: { name: 'Duplicate Name' } })).toBe(1);
  });

  it('rejects a non-existent handler with 400', async () => {
    const payload = {
      name: uniqueName('BadHandler'),
      dateTime: days(10).toISOString(),
      postalCode: '123456',
      deadline: days(5).toISOString(),
      capacity: 10,
      handlerUuid: '00000000-0000-4000-8000-000000000000',
    };
    const response = await api().post('/api/admin/events').send(payload).expect(400);
    expect(response.body.message).toMatch(/handler/i);
  });

  it('rejects a handler that already has an open event with 400', async () => {
    const handler = await createHandler({ name: 'Overloaded' });
    await createEvent(handler.uuid, { deadline: days(5), capacity: 50 });

    const payload = {
      name: uniqueName('SecondOpen'),
      dateTime: days(20).toISOString(),
      postalCode: '123456',
      deadline: days(15).toISOString(),
      capacity: 10,
      handlerUuid: handler.uuid,
    };
    const response = await api().post('/api/admin/events').send(payload).expect(400);
    expect(response.body.message).toMatch(/open event/i);
  });

  it('allows a handler to take a new open event once the previous open one is closed', async () => {
    const handler = await createHandler();
    await createEvent(handler.uuid, { deadline: days(-1), capacity: 10 });

    const payload = {
      name: uniqueName('AfterClosed'),
      dateTime: days(20).toISOString(),
      postalCode: '123456',
      deadline: days(15).toISOString(),
      capacity: 10,
      handlerUuid: handler.uuid,
    };
    await api().post('/api/admin/events').send(payload).expect(200);
  });
});

describe('GET /api/admin/handlers', () => {
  it('returns seeded handler records ordered by name', async () => {
    await createHandler({ name: 'Charlie' });
    await createHandler({ name: 'Alice' });
    await createHandler({ name: 'Bob' });

    const response = await api().get('/api/admin/handlers').expect(200);
    expect(response.body.map((h: { name: string }) => h.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });
});

describe('GET /api/admin/events/:uuid', () => {
  it('returns the event with the same shape as the list', async () => {
    const handler = await createHandler({ name: 'Helper' });
    const event = await createEvent(handler.uuid, { deadline: days(3) });

    const response = await api().get(`/api/admin/events/${event.uuid}`).expect(200);
    expect(response.body.uuid).toBe(event.uuid);
    expect(response.body.handler.uuid).toBe(handler.uuid);
    expect(response.body.registrationCount).toBe(0);
  });

  it('returns 400 when the event is unknown', async () => {
    const response = await api()
      .get('/api/admin/events/00000000-0000-4000-8000-000000000000')
      .expect(400);
    expect(response.body.message).toMatch(/event/i);
  });
});

// Helper used in other suites, kept here for clarity when reading the test layout.
export const _suppressUnused = Op;
