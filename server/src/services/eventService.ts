import { FindOptions, Op, UniqueConstraintError, WhereOptions } from 'sequelize';

import { Event, Handler, isDuplicateEmailError, Registration } from '../models';
import { sequelize } from '../config/database';
import { logger } from '../config/logger';
import { resolveAddress } from './onemapService';
import { addDays, formatDateKey, parseDate, startOfDay, toIsoString } from '../utils/date';
import { clear as clearCache, wrap as wrapCache } from '../utils/cache';
import { clientError, serverError } from '../utils/errors';
import { logSafe } from '../utils/logSafe';
import { escapeLike, openEventCondition, registrationCountLiteral } from '../utils/sql';
import { MAX_PAGE } from '../validators/eventValidators';
import { env } from '../config/env';

// all business logic for the five user stories lives here, and only here.
//
// division of labor:
//   routes       - knows HTTP: reads req, writes res, no business rules
//   validators   - field shape only, never queries the DB
//   eventService - the business; does not import express, so it's directly
//                  unit-testable
//   models       - constraints expressed in the schema
//
// the payoff: routes stay nearly empty, every branch is testable as a plain
// function call, and swapping out Express wouldn't touch a line here.
//
// read-through caching (see utils/cache.ts) sits in this layer rather than in
// the routes because "which reads may be cached, and which writes invalidate
// them" is a statement about the business data, not about HTTP. The routes
// only learn the outcome - hit or miss - through the optional CacheMeta
// callback, so they can stamp a response header without the service ever
// knowing a response exists.

// ------------------------------------------------------------------ DTOs
// why not serialize the Model directly?
// 1) the Model carries updatedAt / handlerUuid and other internals that
//    shouldn't be exposed;
// 2) times must be normalized to ISO strings - otherwise the client's
//    shape depends on Sequelize's config;
// 3) admin and public see different fields - the public shouldn't learn
//    who handles an event.

export interface AdminEventDto {
  uuid: string;
  createdAt: string;
  name: string;
  dateTime: string;
  address: string;
  deadline: string;
  capacity: number;
  registrationCount: number;
  handler: { uuid: string; name: string };
}

export interface PublicEventDto {
  uuid: string;
  name: string;
  dateTime: string;
  address: string;
  deadline: string;
}

export interface TrendPointDto {
  date: string;
  registrationCount: number;
  newRegistrationCount: number;
}

export interface CreateEventInput {
  name: string;
  // unknown rather than string: the service makes no assumption about the
  // date's shape and delegates entirely to parseDate, so JSON bodies, form
  // data and script calls all work
  dateTime: unknown;
  postalCode: string;
  deadline: unknown;
  capacity: number;
  handlerUuid: string;
}

export interface RegisterInput {
  eventUuid: string;
  emailAddress: string;
}

export interface ListEventsQuery {
  page: number;
  search?: string;
  open?: boolean;
}

// ------------------------------------------------------------------ internals

/** Event instance -> client-facing shape.
 *  handler comes from the include and is typed nullable (required: false
 *  makes it optional even though the FK is non-null); guard it so a null
 *  never surfaces as a runtime error. */
const toAdminEventDto = (event: Event): AdminEventDto => {
  const handler = event.get('handler') as Handler | undefined;
  return {
    uuid: event.uuid,
    createdAt: toIsoString(event.createdAt),
    name: event.name,
    dateTime: toIsoString(event.dateTime),
    address: event.address,
    deadline: toIsoString(event.deadline),
    capacity: event.capacity,
    // this comes from the subquery in utils/sql.ts, attached to a VIRTUAL
    // field - readable only via getDataValue, not as a plain property
    registrationCount: Number(event.getDataValue('registrationCount') ?? 0),
    handler: {
      uuid: handler?.uuid ?? '',
      name: handler?.name ?? '',
    },
  };
};

/** List and single-event queries share these attributes so both endpoints
 *  always return identical fields. Extracted because if the registration
 *  count literal ever drifts between the two call sites, you get "the list
 *  says 3 but the detail page says 0" - trivially wrong, painfully found. */
const eventAttributesWithRegistrationCount = {
  include: [[registrationCountLiteral(), 'registrationCount'] as unknown as string],
};

/** How a route learns whether a cached read was served from memory.
 *
 *  A callback instead of changing the return type to `{ data, hit }`: every
 *  existing caller - and every test - would have to be rewritten for
 *  information only the HTTP layer uses. An optional hook costs callers
 *  nothing (pass nothing, get nothing) and keeps the service's return values
 *  exactly what they were.
 *
 *  It must be invoked before the service returns, because the route sets the
 *  X-Cache header from inside it and headers cannot be set after the body has
 *  been written. */
export interface CacheMeta {
  onCacheStatus?: (hit: boolean) => void;
}

/** Read-through helper: the one place that knows the cache is optional.
 *  Every cached read below goes through it, so "cache off in tests" and "tell
 *  the route whether it was a hit" are implemented once instead of five times
 *  with four subtly different variations. */
const readThrough = async <T>(
  key: string,
  loader: () => Promise<T>,
  meta?: CacheMeta,
): Promise<T> => {
  const { value, hit } = await wrapCache(key, env.cacheTtlMs, loader);
  meta?.onCacheStatus?.(hit);
  return value;
};

/** Fetch an event or throw.
 *  Registration, trend and detail all need "does this event exist", and the
 *  error message must be identical everywhere - three copies of
 *  if (!event) throw ... guarantee one copy goes stale on the next edit.
 *  options is passed through to findByPk; the registration path uses it
 *  to take a row lock. */
const requireEvent = async (uuid: string, options: FindOptions = {}): Promise<Event> => {
  const event = await Event.findByPk(uuid, options);
  if (!event) {
    // 400 rather than 404: this API only uses 200/421/400/500, and
    // "resource doesn't exist" is treated as a business error
    throw clientError('This event could not be found. It may have been removed.');
  }
  return event;
};

/** The single definition of "can this event accept registrations":
 *  deadline first, then remaining seats. Kept as two messages because the
 *  user needs to know whether time or headcount blocked them.
 *  registrationCount is passed in - this function never queries, the count
 *  must be taken inside the transaction. */
const assertEventOpen = (event: Event, registrationCount: number): void => {
  if (event.deadline.getTime() <= Date.now()) {
    throw clientError('Registration for this event has closed because the deadline has passed.');
  }
  if (registrationCount >= event.capacity) {
    throw clientError('Registration is closed because this event is already at full capacity.');
  }
};

/** Canonical form of an email: used for storage and unique index matching.
 *  The validator trims too, but that's cleaning the raw input (mobile
 *  keyboards love trailing spaces); the canonical form is defined here.
 *  Trimming again is idempotent and keeps direct service calls clean. */
const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Duplicate-name message lives only here. The pre-check and the unique index
 *  fallback must say the same thing, or the same error surfaces as two
 *  different messages and any frontend matching on message drifts.
 *
 *  The brief requires unique event names, so this is a business rule, not a
 *  database detail: the person filling in the form has to be told which name
 *  is taken, in words they can act on. */
const duplicateNameError = () =>
  clientError('An event with this name already exists. Please choose a different name.');

// ================================================================== Story 1
/** Sequelize types WhereOptions as a union, which makes indexing it with
 *  Op.or / Op.and awkward. This alias adds back the two operator keys the
 *  list query actually uses. */
type EventWhere = WhereOptions & {
  [Op.or]?: WhereOptions[];
  [Op.and]?: WhereOptions[];
};

/** Admin event list: pagination + search + open filter.
 *
 *  How the two filters combine: search is OR (match name, address, or
 *  handler), open is AND (not past deadline and not full). Dumping both
 *  into one object makes Sequelize AND them together, and the search
 *  degenerates into "all three fields contain the term" - which matches
 *  nothing. Hence search in Op.or, open in Op.and, kept independent. */
export const listEventsForAdmin = async (
  { page, search, open }: ListEventsQuery,
  meta?: CacheMeta,
): Promise<{ total: number; events: AdminEventDto[] }> => {
  // page size comes from config, not from the query string
  const limit = env.pageSize;
  // second line of defense: the validator already rejects oversized pages,
  // but the service is called directly by tests and scripts, so it can't
  // assume every caller passed through HTTP.
  const safePage = Math.min(Math.max(1, page), MAX_PAGE);

  // every input that changes the result must be in the key. A key built from
  // only `page` would serve "search=alice" results to "search=bob" - a bug
  // that only shows up once two staff search at the same time.
  // safePage (clamped) rather than page, so out-of-range values that collapse
  // to the same query share one entry.
  const cacheKey = `admin:events:page=${safePage}:search=${search?.trim() ?? ''}:open=${
    open ? 'true' : 'false'
  }`;

  return readThrough(
    cacheKey,
    async () => {
      const where: EventWhere = {};

      if (search && search.trim().length > 0) {
        // escape then wrap in % on both ends: a contains-match. Unescaped, a
        // user typing 50% matches every row in the table.
        const term = `%${escapeLike(search.trim())}%`;
        where[Op.or] = [
          { name: { [Op.like]: term } },
          { address: { [Op.like]: term } },
          // $handler.name$ references the alias of the included association;
          // it must match as: 'handler' in models/index.ts
          { '$handler.name$': { [Op.like]: term } },
        ];
      }

      if (open) {
        // the shared definition from utils/sql - the same condition the public
        // dropdown uses
        where[Op.and] = openEventCondition();
      }

      const offset = (safePage - 1) * limit;

      const { rows, count } = await Event.findAndCountAll({
        where,
        attributes: eventAttributesWithRegistrationCount,
        // required: false = left join; an event still returns if its handler
        // row is somehow missing
        include: [{ model: Handler, as: 'handler', attributes: ['uuid', 'name'], required: false }],
        order: [['dateTime', 'DESC']],
        limit,
        offset,
        // distinct: true is mandatory. The handler association forces a JOIN,
        // so without it count() counts post-JOIN rows and the total inflates -
        // the client renders "3 items" across 5 pages.
        distinct: true,
      });

      return { total: count, events: rows.map(toAdminEventDto) };
    },
    meta,
  );
};

// ================================================================== Story 2
/** Create an event.
 *
 *  Validation order is deliberate, cheapest first:
 *    format -> time ordering -> external API -> transaction (lock + count +
 *    insert)
 *  The external call sits before the transaction because it's the slowest
 *  and most likely to fail (8s timeout). The only steps that need
 *  serializing are the three inside the transaction - "lock the handler
 *  row, count, insert". Keeping the OneMap call outside means the row lock
 *  is never held hostage by an 8-second HTTP request.
 *
 *  Names are labels, not identities: the uuid is what every URL, registration
 *  row and foreign key points at, and a name can be edited later without the
 *  event becoming a different event. But the brief says "the event name must
 *  be unique", so uniqueness is enforced anyway - here for a friendly message
 *  and in the model's unique index for the case where two requests pass this
 *  check at the same time. */
export const createEvent = async (input: CreateEventInput): Promise<Event> => {
  const dateTime = parseDate(input.dateTime);
  const deadline = parseDate(input.deadline);
  if (!dateTime || !deadline) {
    throw clientError(
      'Please choose a valid date and time for the event and for the registration deadline.',
    );
  }

  // The brief: "The event name must be unique." Checked before the external
  // OneMap call because it costs one indexed lookup instead of an 8-second
  // HTTP round trip - a duplicate name should fail fast.
  const existing = await Event.findOne({ where: { name: input.name } });
  if (existing) {
    throw duplicateNameError();
  }

  // the deadline must be strictly before the event starts, or people could
  // register for an event that's already over. >= not >: when the two are
  // equal, registration and the event open simultaneously - effectively no
  // deadline at all.
  if (deadline.getTime() >= dateTime.getTime()) {
    throw clientError('The registration deadline needs to be earlier than the event start time.');
  }

  // No address, no event: resolveAddress returns only an address OneMap
  // confirmed, or throws (unknown code -> 421 on the field, OneMap down or
  // not configured -> 500). It never invents a placeholder.
  const address = await resolveAddress(input.postalCode);

  const { event, handlerName } = await sequelize.transaction(async (transaction) => {
    // lock the handler row. The rule "a handler owns at most one open event"
    // has a race without it: two concurrent requests both count 0 open
    // events, then both insert. Locking the row serializes creation
    // requests for the same handler.
    const handler = await Handler.findByPk(input.handlerUuid, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!handler) {
      throw clientError('The selected handler could not be found. Please choose a handler again.');
    }

    // "open" isn't "not deleted" - it's "not past deadline and not full",
    // so once an event fills up the handler is free to take another. Use
    // the shared condition from utils/sql; a hand-rolled copy here would
    // eventually disagree with the list view about what's open.
    const openEventCount = await Event.count({
      where: { handlerUuid: input.handlerUuid, [Op.and]: openEventCondition() },
      transaction,
    });
    if (openEventCount >= 1) {
      throw clientError(
        `Handler ${handler.name} is already handling an open event. Each handler can only run one open event at a time.`,
      );
    }

    try {
      const created = await Event.create(
        {
          name: input.name,
          dateTime,
          address,
          postalCode: input.postalCode,
          deadline,
          capacity: input.capacity,
          handlerUuid: input.handlerUuid,
        },
        { transaction },
      );
      return { event: created, handlerName: handler.name };
    } catch (error) {
      // Under concurrency, two requests both pass the pre-check and the second
      // one hits the unique index at write time. No need to classify which
      // index: the transaction contains exactly one write, and the uuid is
      // freshly random - only the name can collide.
      // (And classifying is error-prone anyway: MySQL reports the index name,
      // SQLite the column name.)
      if (error instanceof UniqueConstraintError) {
        throw duplicateNameError();
      }
      throw error;
    }
  });

  // after the commit, not inside the transaction: the new event appears in the
  // admin list (and, if open, in the public dropdown) immediately, so the next
  // read must not be served from a snapshot taken before it existed.
  clearCache();

  logger.info(
    `Event created: ${logSafe(event.name)} (${event.uuid}) by handler ${logSafe(handlerName)}`,
  );
  return event;
};

// ================================================================== Story 3
/** Public event dropdown: only events still accepting registrations.
 *
 *  Deliberately uses the same condition as Story 1's open=true
 *  (openEventCondition from utils/sql) - "what the public can register for"
 *  and "what staff see marked open" must be the same set, otherwise staff
 *  see an event as open that the public can't select.
 *
 *  order is ASC (soonest first), the opposite of the admin list's DESC:
 *  the public cares about "what's happening soon", staff about "what was
 *  created recently". */
export const listOpenEventsForPublic = async (meta?: CacheMeta): Promise<PublicEventDto[]> => {
  // no inputs, so the key is constant. Still routed through the same helper so
  // the "cache off" switch and the hit/miss report behave identically here.
  return readThrough(
    'public:events',
    async () => {
      const events = await Event.findAll({
        where: {
          [Op.and]: openEventCondition(),
        },
        // only the five fields the public needs - no capacity, no handler
        attributes: ['uuid', 'name', 'dateTime', 'address', 'deadline'],
        order: [['dateTime', 'ASC']],
      });

      return events.map((event) => ({
        uuid: event.uuid,
        name: event.name,
        dateTime: toIsoString(event.dateTime),
        address: event.address,
        deadline: toIsoString(event.deadline),
      }));
    },
    meta,
  );
};

// ================================================================== Story 4
/** Register. The only place in the system that writes to registrations.
 *
 *  The whole flow sits in one transaction: the capacity check is
 *  "count -> compare with capacity -> insert", and if anyone slips an
 *  insert in between those steps, the event overbooks. Locking the event
 *  row serializes registrations for the same event, keeping the judgment
 *  accurate.
 *
 *  Side benefit: with serialization, count + 1 can't be stolen, so the
 *  5-attempt retry loop is pure insurance (against paths that bypass the
 *  API and write directly). Kept as-is. */
export const registerForEvent = async ({
  eventUuid,
  emailAddress,
}: RegisterInput): Promise<{ registrationNo: string }> => {
  const normalisedEmail = normaliseEmail(emailAddress);

  const { registrationNo, eventName } = await sequelize.transaction(async (transaction) => {
    const event = await requireEvent(eventUuid, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    // duplicate check before deadline/capacity. The order isn't about
    // performance, it's about the answer: someone re-submitting needs to
    // hear "you already registered", not "it's full" - the latter makes
    // them think their first attempt failed. It also keeps the duplicate
    // check independent of capacity, so an event with capacity=1 can still
    // test it.
    // this query only produces the friendly message; the real guard is
    // the unique index below.
    const alreadyRegistered = await Registration.findOne({
      where: { eventUuid, emailAddress: normalisedEmail },
      transaction,
    });
    if (alreadyRegistered) {
      throw clientError('This email address has already registered for the event.');
    }

    const currentCount = await Registration.count({ where: { eventUuid }, transaction });
    assertEventOpen(event, currentCount);

    // running number allocation. Why at most 5 attempts? Each failure
    // means a concurrent request just took this number; recounting yields
    // a new one. Five collisions in a row means the concurrency has
    // outgrown the count+1 scheme - better to fail fast and let the user
    // retry than spin forever.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await Registration.count({ where: { eventUuid }, transaction });
      // padStart turns 1 into 00001; capacity is capped at 99999, so six
      // digits can never happen here.
      const candidate = String(count + 1).padStart(5, '0');
      try {
        const registration = await Registration.create(
          {
            eventUuid,
            emailAddress: normalisedEmail,
            registrationNo: candidate,
          },
          { transaction },
        );
        return { registrationNo: registration.registrationNo, eventName: event.name };
      } catch (error: unknown) {
        // two possible unique collisions: the running number, or the email.
        // They must be told apart - an email collision is a rejection (400,
        // no retry), a number collision is our own race (recount, retry).
        // Classification goes through isDuplicateEmailError in
        // models/registration: MySQL reports the index name, SQLite the
        // column name, and this layer shouldn't know dialect quirks.
        if (isDuplicateEmailError(error)) {
          throw clientError('This email address has already registered for the event.');
        }
        // otherwise the number was taken; next iteration recounts
        // keep the cause for the log line below - without it the error
        // that finally ended the retries never shows up anywhere
        lastError = error;
      }
    }

    logger.error('Failed to allocate registration number', lastError);
    throw serverError('We could not assign a registration number just now. Please try again.');
  });

  // registrationCount is part of the admin list and of the event detail, and a
  // new registration can also push an event out of the public dropdown once it
  // reaches capacity - so every cached read is now stale, not just one.
  clearCache();

  logger.info(
    `Registration accepted for event ${logSafe(eventName)}: ${logSafe(normalisedEmail)} -> #${registrationNo}`,
  );
  return { registrationNo };
};

// ================================================================== Story 5
/** Daily registration trend.
 *
 *  Two subtleties in the reporting:
 *
 *  1. Why does the range start at the event's creation date rather than the
 *     first registration? The chart answers "how did signups accumulate
 *     since the event went live". A day with zero registrations should show
 *     0, not vanish from the chart.
 *
 *  2. Why are out-of-range registrations merged back in? Normally there
 *     aren't any (registration closes after the deadline), but migrated
 *     data or an edited deadline can produce them. Better to append them by
 *     date than to quietly undercount - the chart may grow a few extra
 *     days, but the total must be right. */
export const getEventTrend = async (
  eventUuid: string,
  meta?: CacheMeta,
): Promise<TrendPointDto[]> => {
  // the trend is the most expensive read in the system: it loads every
  // registration row for the event and buckets them in memory. Caching it per
  // uuid is what keeps two people watching the same chart from doubling that
  // work. Registrations invalidate it through clear() in registerForEvent.
  return readThrough(
    `admin:event:${eventUuid}:trend`,
    async () => {
      const event = await requireEvent(eventUuid);

      // only createdAt: the trend needs "which day", not who registered
      const registrations = await Registration.findAll({
        where: { eventUuid },
        attributes: ['createdAt'],
        order: [['createdAt', 'ASC']],
        raw: true,
      });

      // day key -> new registrations that day. Map over object to avoid
      // surprises with keys like "constructor"
      const createdAtByDay = new Map<string, number>();
      const bump = (key: string) => createdAtByDay.set(key, (createdAtByDay.get(key) ?? 0) + 1);

      // lay out every day in the range as 0 first, so empty days still appear
      const start = startOfDay(event.createdAt);
      const end = startOfDay(event.deadline);
      const keys: string[] = [];
      for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
        const key = formatDateKey(cursor);
        keys.push(key);
        createdAtByDay.set(key, 0);
      }

      // then bucket the real registrations (they may land outside the laid-out
      // range)
      for (const registration of registrations) {
        bump(formatDateKey(new Date(registration.createdAt)));
      }

      // merge + sort. The Set dedupes so the pre-laid zeros and real data
      // aren't double-counted
      const allKeys = Array.from(new Set([...keys, ...createdAtByDay.keys()])).sort();
      let cumulative = 0;
      return allKeys.map((date) => {
        // the cumulative total rides this rolling counter instead of
        // re-querying a total per day
        cumulative += createdAtByDay.get(date) ?? 0;
        return {
          date,
          registrationCount: cumulative,
          newRegistrationCount: createdAtByDay.get(date) ?? 0,
        };
      });
    },
    meta,
  );
};

// ================================================================== helpers
/** Single event detail, for the trend page header.
 *  Shares eventAttributesWithRegistrationCount and toAdminEventDto with the
 *  list, so the detail page and list rows always agree on fields and
 *  formats. */
export const getEventByUuid = async (
  eventUuid: string,
  meta?: CacheMeta,
): Promise<AdminEventDto> => {
  // keyed by uuid: an unknown uuid throws inside the loader, and a thrown
  // loader is never cached, so "not found" can't stick to a uuid that is
  // created a moment later.
  return readThrough(
    `admin:event:${eventUuid}`,
    async () => {
      const event = await requireEvent(eventUuid, {
        attributes: eventAttributesWithRegistrationCount,
        include: [{ model: Handler, as: 'handler', attributes: ['uuid', 'name'], required: false }],
      });
      return toAdminEventDto(event);
    },
    meta,
  );
};

/** Staff list. Serves only the create-event dropdown - there's no staff
 *  management module; data is written by the seed script, read here.
 *  Sorted by name so the dropdown order is stable across refreshes. */
export const listHandlers = async (
  meta?: CacheMeta,
): Promise<Array<{ uuid: string; name: string }>> => {
  return readThrough(
    'admin:handlers',
    async () => {
      const handlers = await Handler.findAll({
        attributes: ['uuid', 'name'],
        order: [['name', 'ASC']],
      });
      return handlers.map((handler) => ({ uuid: handler.uuid, name: handler.name }));
    },
    meta,
  );
};
