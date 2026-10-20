import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler, Registration } from '../models';

const api = () => request(app);

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const createHandler = async () =>
  Handler.create({
    uuid: randomUUID(),
    name: `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

describe('POST /api/admin/events/:uuid/trend', () => {
  it('returns one row per day from event creation to the deadline with cumulative totals', async () => {
    const handler = await createHandler();
    const createdAt = new Date(Date.now() - 3 * 86_400_000);
    const event = await Event.create({
      name: 'Trend Event',
      dateTime: days(20),
      deadline: days(5),
      capacity: 50,
      address: 'Singapore 123456',
      postalCode: '123456',
      handlerUuid: handler.uuid,
      createdAt,
    } as any);

    // 3 registrations on 3 different days: day-3, day-1, today.
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'a@x.com',
      registrationNo: '00001',
      createdAt: createdAt,
    } as any);
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'b@x.com',
      registrationNo: '00002',
      createdAt: new Date(Date.now() - 1 * 86_400_000),
    } as any);
    await Registration.create({
      eventUuid: event.uuid,
      emailAddress: 'c@x.com',
      registrationNo: '00003',
      createdAt: new Date(),
    } as any);

    const response = await api().post(`/api/admin/events/${event.uuid}/trend`).expect(200);
    const rows = response.body;
    expect(Array.isArray(rows)).toBe(true);
    // Should include every day from createdAt to deadline inclusive (9 days: day-3, -2, -1, 0, 1, 2, 3, 4, 5)
    expect(rows.length).toBe(9);

    // New registrations per day: only 3 days should have new > 0.
    const withNew = rows.filter(
      (r: { newRegistrationCount: number }) => r.newRegistrationCount > 0,
    );
    expect(withNew).toHaveLength(3);
    // Cumulative at the end = 3.
    const last = rows[rows.length - 1];
    expect(last.registrationCount).toBe(3);
    expect(last.newRegistrationCount).toBe(0);

    // The first day (event creation day) should reflect the registration made at that point.
    const first = rows[0];
    expect(first.newRegistrationCount).toBe(1);
    expect(first.registrationCount).toBe(1);

    // Each row's shape must match the spec.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['date', 'newRegistrationCount', 'registrationCount'].sort(),
      );
      expect(typeof row.date).toBe('string');
      expect(/^\d{4}-\d{2}-\d{2}$/.test(row.date)).toBe(true);
      expect(typeof row.registrationCount).toBe('number');
      expect(typeof row.newRegistrationCount).toBe('number');
    }
  });

  it('returns only zero-registration days for an event with no registrations', async () => {
    const handler = await createHandler();
    const createdAt = new Date(Date.now() - 2 * 86_400_000);
    const event = await Event.create({
      name: 'Empty Event',
      dateTime: days(10),
      deadline: days(2),
      capacity: 10,
      address: 'Singapore 123456',
      postalCode: '123456',
      handlerUuid: handler.uuid,
      createdAt,
    } as any);

    const response = await api().post(`/api/admin/events/${event.uuid}/trend`).expect(200);
    expect(response.body.length).toBe(5); // day-2, day-1, day0, day+1, day+2
    expect(
      response.body.every(
        (r: { newRegistrationCount: number; registrationCount: number }) =>
          r.newRegistrationCount === 0 && r.registrationCount === 0,
      ),
    ).toBe(true);
  });

  it('returns 400 when the event is unknown', async () => {
    const response = await api()
      .post('/api/admin/events/00000000-0000-4000-8000-000000000000/trend')
      .expect(400);
    expect(response.body.message).toMatch(/event/i);
  });

  it('returns 421 when the uuid param is malformed', async () => {
    const response = await api().post('/api/admin/events/not-a-uuid/trend').expect(421);
    expect(response.body.message).toMatch(/check the highlighted fields/i);
  });
});
