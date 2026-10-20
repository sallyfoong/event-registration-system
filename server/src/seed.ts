import { sequelize } from './config/database';
import { Event, Handler, Registration } from './models';
import { logger } from './config/logger';
import { env } from './config/env';
import { resolveAddress } from './services/onemapService';

// staff have no management UI in the spec, so this table can only be filled
// by script. Demo data is optional but useful - an empty list is a poor way
// to explore the features.
//
// two modes:
//   npm run seed          just the 4 staff, enough to create events
//   npm run seed -- --demo also 3 events + a few registrations, so the
//                         trend chart has something to show

const DEMO_HANDLERS: Array<{ name: string; email: string }> = [
  { name: 'Alice Tan', email: 'alice.tan@company.com' },
  { name: 'Bob Lim', email: 'bob.lim@company.com' },
  { name: 'Carol Ng', email: 'carol.ng@company.com' },
  { name: 'David Wong', email: 'david.wong@company.com' },
];

const isDemoSeed = process.argv.includes('--demo');

/** Seed staff. findOrCreate instead of create so the script is idempotent -
 *  a second run must not blow up on duplicate emails or duplicate the
 *  people. Running the seed twice is common enough to design for. */
async function seedHandlers(): Promise<Handler[]> {
  const seeded: Handler[] = [];
  for (const profile of DEMO_HANDLERS) {
    const [handler] = await Handler.findOrCreate({
      where: { email: profile.email },
      defaults: profile,
    });
    seeded.push(handler);
    logger.info(`${handler.name} (${handler.uuid}) ${handler.email}`);
  }
  return seeded;
}

/** Stable identities for the demo events.
 *
 *  Why hard-coded uuids: the seed has to be idempotent, and "have I already
 *  created this?" can only be answered by an identity that doesn't change.
 *  The event name is a label - someone renames a demo event, or adds a second
 *  "Career Fair", and a name-keyed lookup either inserts a duplicate or
 *  attaches registrations to the wrong row. A fixed uuid makes the lookup
 *  exact: same row, every run, forever. These values are constants rather
 *  than freshly generated precisely so that a second run finds the first
 *  run's rows instead of creating new ones.
 *
 *  Format is a real v4 uuid (version nibble and variant bits set) so the
 *  values survive any uuid validation they might meet. */
const DEMO_EVENT_UUIDS = {
  summit: '5f0f1a10-1c2b-4d3e-9a41-000000000001',
  greenForum: '5f0f1a10-1c2b-4d3e-9a41-000000000002',
  pastNetworking: '5f0f1a10-1c2b-4d3e-9a41-000000000003',
} as const;

/** Demo data. Writes through the models instead of the service, because the
 *  service hits OneMap and enforces the handler-availability rule - seeding
 *  needs "this data definitely gets created" and must not depend on an
 *  external service being reachable.
 *
 *  findOrCreate keyed on the event uuid, so running the seed twice does not
 *  duplicate anything - and, unlike a name-keyed lookup, renaming a demo event
 *  between runs still matches the existing row. Deploy scripts get re-run. */
async function seedDemoData(handlers: Handler[]): Promise<void> {
  const [primary, secondary] = handlers;
  if (!primary || !secondary) return;

  const days = (n: number) => new Date(Date.now() + n * 86_400_000);

  const upsertEvent = async (
    uuid: string,
    values: {
      name: string;
      dateTime: Date;
      postalCode: string;
      deadline: Date;
      capacity: number;
      handlerUuid: string;
      createdAt?: Date;
    },
  ): Promise<Event> => {
    // Resolved through the same function the API uses. Hard-coding an address
    // here would let a broken OneMap configuration go unnoticed until someone
    // created a real event - and the seeded rows are what a reviewer sees
    // first.
    const address = await resolveAddress(values.postalCode);
    const [event] = await Event.findOrCreate({
      where: { uuid },
      defaults: { uuid, ...values, address },
    });
    return event;
  };

  // event 1: open, createdAt pushed back 3 days so the trend chart has
  // history to plot
  const sample1 = await upsertEvent(DEMO_EVENT_UUIDS.summit, {
    name: 'Tech Innovation Summit 2026',
    dateTime: days(30),
    postalCode: '238859',
    deadline: days(25),
    capacity: 200,
    handlerUuid: primary.uuid,
    createdAt: new Date(Date.now() - 3 * 86_400_000),
  });

  // event 2: also open, but assigned to a different handler - a handler
  // can't hold two open events at once, and the seed must respect the
  // same business rule
  const sample2 = await upsertEvent(DEMO_EVENT_UUIDS.greenForum, {
    name: 'Singapore Green Forum',
    dateTime: days(14),
    postalCode: '178957',
    deadline: days(10),
    capacity: 100,
    handlerUuid: secondary.uuid,
  });

  // event 3: deadline passed. Verifies admin sees it while the public list
  // doesn't.
  await upsertEvent(DEMO_EVENT_UUIDS.pastNetworking, {
    name: 'Past Members Networking (closed)',
    dateTime: days(-7),
    postalCode: '049213',
    deadline: days(-1),
    capacity: 50,
    handlerUuid: primary.uuid,
  });

  const sampleEmails = [
    'jane.doe@example.com',
    'john.smith@example.com',
    'wei.chen@example.com',
    'priya.kumar@example.com',
  ];

  // registrations are keyed on (eventUuid, emailAddress) - the same pair the
  // unique index uses - so a re-run updates nothing and inserts nothing
  for (let i = 0; i < sampleEmails.length; i += 1) {
    const registrationDate = new Date(Date.now() - (2 - (i % 3)) * 86_400_000);
    await Registration.findOrCreate({
      where: { eventUuid: sample1.uuid, emailAddress: sampleEmails[i] },
      defaults: {
        eventUuid: sample1.uuid,
        emailAddress: sampleEmails[i],
        registrationNo: String(i + 1).padStart(5, '0'),
        createdAt: registrationDate,
      },
    });
  }
  await Registration.findOrCreate({
    where: { eventUuid: sample2.uuid, emailAddress: 'sara.lim@example.com' },
    defaults: {
      eventUuid: sample2.uuid,
      emailAddress: 'sara.lim@example.com',
      registrationNo: '00001',
      createdAt: new Date(),
    },
  });

  logger.info('Demo data seeded: events + registrations');
}

async function main(): Promise<void> {
  logger.info(`Starting seed (NODE_ENV=${env.nodeEnv}, DB_DIALECT=${env.db.dialect})`);
  // sync first so the seed can run standalone, before the app ever boots
  await sequelize.sync();
  const handlers = await seedHandlers();
  if (isDemoSeed) {
    await seedDemoData(handlers);
  }
  // close the pool or the process hangs around after finishing
  await sequelize.close();
  logger.info('Seed complete');
}

main().catch(async (err) => {
  logger.error('Seed failed', err);
  // close the pool on the failure path too, or the process lingers - in CI
  // that shows up as "command timed out" instead of "command failed", which
  // is far harder to diagnose
  try {
    await sequelize.close();
  } catch {
    /* noop */
  }
  process.exit(1);
});
