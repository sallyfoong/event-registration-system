/** Trend date range: "all dates from event creation date till registration deadline".
 *
 *  The range is what makes the chart readable: a day with no registrations
 *  must still appear (with 0 new and an unchanged cumulative total), otherwise
 *  the line jumps and the reader cannot tell a quiet day from a missing day.
 *
 *  Expected dates are computed with an independent local-date helper here
 *  (not by importing utils/date) so the assertion cannot pass just because
 *  the test and the implementation share the same bug.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';

import app from '../app';
import { Event, Handler, Registration } from '../models';

interface TrendRow {
  date: string;
  registrationCount: number;
  newRegistrationCount: number;
}

const api = () => request(app);

const uniqueName = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Returns a helper that resolves "today + offset" at a given local hour.
 *  A single `now` is captured so a test that straddles midnight cannot drift. */
const dayFactory = () => {
  const now = new Date();
  return (offset: number, hour = 12): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0);
};

const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const expectedDateKeys = (
  day: (offset: number, hour?: number) => Date,
  fromOffset: number,
  toOffset: number,
): string[] => {
  const keys: string[] = [];
  for (let offset = fromOffset; offset <= toOffset; offset += 1) {
    keys.push(dateKey(day(offset)));
  }
  return keys;
};

const createHandler = async () =>
  Handler.create({
    uuid: randomUUID(),
    name: `Handler ${Math.random().toString(36).slice(2, 8)}`,
    email: `h${Math.random().toString(36).slice(2, 6)}@company.com`,
  });

const createEvent = async (
  handlerUuid: string,
  fields: { dateTime: Date; deadline: Date; createdAt: Date },
) =>
  Event.create({
    name: uniqueName('Trend Range'),
    dateTime: fields.dateTime,
    deadline: fields.deadline,
    capacity: 50,
    address: 'Singapore 123456',
    postalCode: '123456',
    handlerUuid,
    createdAt: fields.createdAt,
  } as any);

const createRegistration = async (eventUuid: string, registrationNo: string, createdAt: Date) =>
  Registration.create({
    eventUuid,
    emailAddress: `r${registrationNo}@example.com`,
    registrationNo,
    createdAt,
  } as any);

describe('POST /api/admin/events/:uuid/trend - date range', () => {
  it('spans every day from the creation date to the deadline and keeps a running total', async () => {
    const day = dayFactory();
    const handler = await createHandler();
    // Created 3 days ago, deadline in 5 days -> 9 calendar days inclusive.
    const event = await createEvent(handler.uuid, {
      createdAt: day(-3, 9),
      dateTime: day(10, 9),
      deadline: day(5, 18),
    });

    // day -3, day -1, today, and the deadline day itself.
    await createRegistration(event.uuid, '00001', day(-3, 12));
    await createRegistration(event.uuid, '00002', day(-1, 12));
    await createRegistration(event.uuid, '00003', day(0, 12));
    await createRegistration(event.uuid, '00004', day(5, 10));

    const response = await api().post(`/api/admin/events/${event.uuid}/trend`).expect(200);
    const rows = response.body as TrendRow[];

    // Contiguity: no day is skipped, in either direction.
    expect(rows.map((row) => row.date)).toEqual(expectedDateKeys(day, -3, 5));

    // First day = creation date, last day = deadline date (both inclusive).
    expect(rows[0].date).toBe(dateKey(day(-3)));
    expect(rows[rows.length - 1].date).toBe(dateKey(day(5)));

    // Quiet days are present with 0 new registrations...
    expect(rows.map((row) => row.newRegistrationCount)).toEqual([1, 0, 1, 1, 0, 0, 0, 0, 1]);
    // ...and the cumulative total does not move on them (never decreases).
    expect(rows.map((row) => row.registrationCount)).toEqual([1, 1, 2, 3, 3, 3, 3, 3, 4]);
  });

  it('returns one zero row when the whole range falls on a single day', async () => {
    const day = dayFactory();
    const handler = await createHandler();
    // Created and closed on the same day: the range is exactly that day.
    const event = await createEvent(handler.uuid, {
      createdAt: day(0, 9),
      deadline: day(0, 23),
      dateTime: day(1, 9),
    });

    const response = await api().post(`/api/admin/events/${event.uuid}/trend`).expect(200);

    expect(response.body).toEqual([
      { date: dateKey(day(0)), registrationCount: 0, newRegistrationCount: 0 },
    ]);
  });
});
