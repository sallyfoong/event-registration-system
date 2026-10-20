import { Router } from 'express';

import { listOpenEventsForPublic, registerForEvent } from '../services/eventService';
import { registerValidation } from '../validators/eventValidators';
import { validateRequest } from '../middleware/validateRequest';
import { asyncHandler } from '../middleware/errorHandler';
import { HttpStatus } from '../utils/errors';

// the only two endpoints the public can reach. They cannot list staff,
// see other people's registrations, or discover closed/full events.
//
// this router sits behind a rate limiter in app.ts, so individual handlers
// don't worry about abuse - that's the point of the layering: policy
// changes happen in one place.

const router = Router();

/** Story 3: open events visible to the public (the dropdown's data source).
 *  Takes no parameters - the public should not be able to filter for
 *  closed events.
 *
 *  This is the hottest read in the system (every visitor's first request), and
 *  it is identical for every caller, which makes it the best possible cache
 *  candidate. The header reports whether this response came from memory, so
 *  the behaviour is observable from outside. */
router.get(
  '/events',
  asyncHandler(async (_req, res) => {
    const events = await listOpenEventsForPublic({
      onCacheStatus: (hit) => res.setHeader('X-Cache', hit ? 'HIT' : 'MISS'),
    });
    res.status(HttpStatus.OK).json(events);
  }),
);

/** Story 4: register.
 *
 *  emailAddress is trimmed and format-checked in the validator; the service
 *  lowercases it so the unique index actually works
 *  (Alice@x.com and alice@x.com must count as the same address).
 *
 *  Success returns 200 + { registrationNo } - the number allocated and
 *  persisted by the service, never computed on the client. */
router.post(
  '/register',
  registerValidation,
  validateRequest,
  asyncHandler(async (req, res) => {
    const { eventUuid, emailAddress } = req.body as { eventUuid: string; emailAddress: string };
    const result = await registerForEvent({ eventUuid, emailAddress });
    res.status(HttpStatus.OK).json(result);
  }),
);

export default router;
