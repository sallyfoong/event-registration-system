import { getValidated, postValidated, postVoid } from './client';
import {
  adminEventListSchema,
  adminEventSchema,
  handlerListSchema,
  publicEventListSchema,
  registrationResultSchema,
  trendPointListSchema,
  type AdminEvent,
  type AdminEventList,
  type CreateEventPayload,
  type Handler,
  type PublicEvent,
  type RegisterPayload,
  type RegistrationResult,
  type TrendPoint,
} from './schemas';

// One function per backend endpoint; no URL strings in pages.
//
// Each function is a path plus the schema that describes its response - the
// request helpers in client.ts do the sending and the validating, so nothing
// here has to touch an untyped payload or repeat a shape that schemas.ts
// already declares.
//
// Two things are decided here and only here:
//   1. Path building - changing a path can't miss a page.
//   2. Param translation - e.g. turning open: boolean into the 'true' string
//      the API expects; pages never learn the wire format.

export interface ListEventsParams {
  page: number;
  search?: string;
  open?: boolean;
}

/** Employee-side event list.
 *
 *  Two deliberate "don't send" cases:
 *  - Empty search becomes undefined. The backend would tolerate search='',
 *    but "no search" and "search for the empty string" are different things.
 *  - open is omitted when false. The backend only defines open=true;
 *    sending open=false comes back as a 421. */
export const fetchAdminEvents = async ({
  page,
  search,
  open,
}: ListEventsParams): Promise<AdminEventList> =>
  getValidated('/admin/events', adminEventListSchema, {
    params: {
      page,
      search: search?.trim() || undefined,
      open: open ? 'true' : undefined,
    },
  });

/** Single event detail, used by the trend page's header. */
export const fetchAdminEvent = (uuid: string): Promise<AdminEvent> =>
  getValidated(`/admin/events/${uuid}`, adminEventSchema);

/** Handler options for the create-event dropdown. */
export const fetchHandlers = (): Promise<Handler[]> =>
  getValidated('/admin/handlers', handlerListSchema);

/** Create event. The backend returns 200 + null, so there is nothing to
 *  validate and nothing to return - the caller invalidates the list instead of
 *  guessing the new row into the cache. */
export const createEvent = (payload: CreateEventPayload): Promise<void> =>
  postVoid('/admin/events', payload);

/** Public list of open events. */
export const fetchPublicEvents = (): Promise<PublicEvent[]> =>
  getValidated('/public/events', publicEventListSchema);

/** Registration.
 *  registrationNo is assigned by the backend; the frontend only displays it.
 *  Numbering it client-side would collide as soon as two tabs are open. */
export const registerForEvent = (payload: RegisterPayload): Promise<RegistrationResult> =>
  postValidated('/public/register', registrationResultSchema, payload);

/** Daily trend. POST, not GET - that's the documented contract, and a
 *  REST-idiomatic GET would 404 for anyone calling it as specified. */
export const fetchEventTrend = (uuid: string): Promise<TrendPoint[]> =>
  postValidated(`/admin/events/${uuid}/trend`, trendPointListSchema);
