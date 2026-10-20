import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler, Registration } from '../models';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const createHandler = async (overrides: Partial<{ name: string; email: string }> = {}) =>
  Handler.create({
    uuid: randomUUID(),
    name: overrides.name ?? `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: overrides.email ?? `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

const createEvent = async (
  handlerUuid: string,
  overrides: Partial<{
    name: string;
    dateTime: Date;
    deadline: Date;
    capacity: number;
    address: string;
    postalCode: string;
  }> = {},
) =>
  Event.create({
    name: overrides.name ?? `Event ${Math.random().toString(36).slice(2, 8)}`,
    dateTime: overrides.dateTime ?? days(7),
    deadline: overrides.deadline ?? days(5),
    capacity: overrides.capacity ?? 10,
    address: overrides.address ?? 'Singapore 123456',
    postalCode: overrides.postalCode ?? '123456',
    handlerUuid,
  });

describe('GET /api/public/events', () => {
  it('returns only open events with the spec fields and orders by event date asc', async () => {
    const handler = await createHandler();
    const open1 = await createEvent(handler.uuid, {
      name: 'Soonest Open',
      dateTime: days(2),
      deadline: days(1),
    });
    const open2 = await createEvent(handler.uuid, {
      name: 'Later Open',
      dateTime: days(10),
      deadline: days(9),
    });
    const closed = await createEvent(handler.uuid, { name: 'Closed', deadline: days(-1) });
    const full = await createEvent(handler.uuid, { name: 'Full', deadline: days(5), capacity: 1 });
    await Registration.create({
      eventUuid: full.uuid,
      emailAddress: 'a@x.com',
      registrationNo: '00001',
    });

    const response = await api().get('/api/public/events').expect(200);
    expect(response.body).toHaveLength(2);
    const uuids = response.body.map((e: { uuid: string }) => e.uuid);
    expect(uuids).toEqual([open1.uuid, open2.uuid]);
    expect(Object.keys(response.body[0]).sort()).toEqual(
      ['address', 'dateTime', 'deadline', 'name', 'uuid'].sort(),
    );
    expect(response.body.find((e: { uuid: string }) => e.uuid === closed.uuid)).toBeUndefined();
    expect(response.body.find((e: { uuid: string }) => e.uuid === full.uuid)).toBeUndefined();
  });
});

describe('POST /api/public/register', () => {
  it('issues a 5-digit running number unique to the event and returns 200', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(5), capacity: 10 });

    const r1 = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'first@example.com' })
      .expect(200);
    expect(r1.body).toEqual({ registrationNo: '00001' });

    const r2 = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'second@example.com' })
      .expect(200);
    expect(r2.body).toEqual({ registrationNo: '00002' });

    const persisted = await Registration.findAll({
      where: { eventUuid: event.uuid },
      order: [['registrationNo', 'ASC']],
    });
    expect(persisted.map((r) => r.registrationNo)).toEqual(['00001', '00002']);
  });

  it('rejects a duplicate email on the same event with 400', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(5) });

    await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'dup@example.com' })
      .expect(200);

    const dup = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'dup@example.com' })
      .expect(400);
    expect(dup.body.message).toMatch(/already registered/i);
  });

  it('rejects an invalid email with 421', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(5) });

    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'not-an-email' })
      .expect(421);
    expect(response.body.message).toMatch(/check the highlighted fields/i);
    const fields = (response.body.errors as Array<{ field: string }>).map((e) => e.field);
    expect(fields).toContain('emailAddress');
  });

  it('rejects a malformed eventUuid with 421', async () => {
    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: 'not-a-uuid', emailAddress: 'x@example.com' })
      .expect(421);
    expect(response.body.message).toMatch(/check the highlighted fields/i);
  });

  it('rejects an unknown eventUuid with 400', async () => {
    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: '00000000-0000-4000-8000-000000000000', emailAddress: 'a@example.com' })
      .expect(400);
    expect(response.body.message).toMatch(/event/i);
  });

  it('rejects registrations once the deadline has passed with 400', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(-1) });
    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'a@example.com' })
      .expect(400);
    expect(response.body.message).toMatch(/deadline/i);
  });

  it('rejects registrations when the event is full with 400', async () => {
    const handler = await createHandler();
    const event = await createEvent(handler.uuid, { deadline: days(3), capacity: 1 });
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'first@example.com',
      registrationNo: '00001',
    });
    const response = await api()
      .post('/api/public/register')
      .send({ eventUuid: event.uuid, emailAddress: 'second@example.com' })
      .expect(400);
    expect(response.body.message).toMatch(/capacity/i);
  });
});
