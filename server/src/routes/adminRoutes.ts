import { Response, Router } from 'express';

import {
  createEvent,
  getEventByUuid,
  getEventTrend,
  listEventsForAdmin,
  listHandlers,
} from '../services/eventService';
import {
  createEventValidation,
  eventUuidParamValidation,
  listEventsValidation,
} from '../validators/eventValidators';
import { validateRequest } from '../middleware/validateRequest';
import { asyncHandler } from '../middleware/errorHandler';
import { HttpStatus } from '../utils/errors';

// routes do three things only: map a URL to a service function, pull the
// relevant pieces out of req, and send the result with the agreed status
// code. No business judgment belongs here - an `if` deciding "may this be
// created" in this layer means the logic ended up in the wrong place.
//
// every POST/GET chain follows the same order:
//   validator chain -> validateRequest -> asyncHandler(business)
// the order can't change: validateRequest must read results after the
// validators run, and asyncHandler only makes sense wrapping the final
// async function.

const router = Router();

/** Stamp whether the read came from the in-process cache.
 *
 *  Why a response header at all: without it, "the cache works" and "the cache
 *  silently never hits" look identical from the outside, and the only way to
 *  tell them apart is to add logging and rebuild. One header makes the
 *  behaviour observable from curl and from the browser network tab.
 *
 *  Why the callback and not a changed return type: the service returns data,
 *  not transport metadata. Handing it a callback keeps every existing caller
 *  and test working unchanged - the header is the route's business. */
const cacheStatusHeader =
  (res: Response) =>
  (hit: boolean): void => {
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  };

/** Story 1: paginated event list with search + open filter. */
router.get(
  '/events',
  listEventsValidation,
  validateRequest,
  asyncHandler(async (req, res) => {
    // page gets a fallback default here because optional() in the validator
    // doesn't fill one in. parseInt + || 1 is safe: the validator has
    // already rejected unparseable values, so anything reaching this point
    // is either a valid positive integer or absent.
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    // open accepts 'true' and '1' as equivalents (the validator allows both),
    // but the service takes a boolean - normalise here
    const openFlag = req.query.open;
    const open = openFlag === 'true' || openFlag === '1';
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const result = await listEventsForAdmin(
      { page, search, open },
      { onCacheStatus: cacheStatusHeader(res) },
    );
    res.status(HttpStatus.OK).json(result);
  }),
);

/** Support endpoint: staff dropdown for the create-event form.
 *  There is no staff management module; data comes from the seed. */
router.get(
  '/handlers',
  asyncHandler(async (_req, res) => {
    const handlers = await listHandlers({ onCacheStatus: cacheStatusHeader(res) });
    res.status(HttpStatus.OK).json(handlers);
  }),
);

/** Story 2: create an event.
 *  The body is null: the spec doesn't define a creation response, and the
 *  frontend jumps back to the list and refetches anyway - no need to return
 *  the event detail here. */
router.post(
  '/events',
  createEventValidation,
  validateRequest,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name: string;
      dateTime: string;
      postalCode: string;
      deadline: string;
      capacity: number;
      handlerUuid: string;
    };
    await createEvent({
      name: body.name,
      dateTime: body.dateTime,
      postalCode: body.postalCode,
      deadline: body.deadline,
      // the validator's toInt() already coerced this; repeating Number()
      // is defensive in case someone calls the service directly and skips
      // the validator
      capacity: Number(body.capacity),
      handlerUuid: body.handlerUuid,
    });
    res.status(HttpStatus.OK).json(null);
  }),
);

/** Support endpoint: single event detail, for the trend page header. */
router.get(
  '/events/:uuid',
  eventUuidParamValidation,
  validateRequest,
  asyncHandler(async (req, res) => {
    const event = await getEventByUuid(req.params.uuid, {
      onCacheStatus: cacheStatusHeader(res),
    });
    res.status(HttpStatus.OK).json(event);
  }),
);

/** Story 5: daily registration trend.
 *  POST even though it's semantically a query - the API contract says so,
 *  and unilaterally changing it to GET would 404 every client written
 *  against the documented contract. Being a POST doesn't make it uncacheable:
 *  the method is a naming decision, the cache cares about the uuid it reads. */
router.post(
  '/events/:uuid/trend',
  eventUuidParamValidation,
  validateRequest,
  asyncHandler(async (req, res) => {
    const trend = await getEventTrend(req.params.uuid, {
      onCacheStatus: cacheStatusHeader(res),
    });
    res.status(HttpStatus.OK).json(trend);
  }),
);

export default router;
