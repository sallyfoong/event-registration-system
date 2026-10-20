import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createEvent,
  fetchAdminEvent,
  fetchAdminEvents,
  fetchEventTrend,
  fetchHandlers,
  fetchPublicEvents,
  registerForEvent,
  type ListEventsParams,
} from './events';

// Turns "firing requests" into "managing server state".
//
// The alternative is every page doing its own useState + useEffect: manual
// loading/error/data state, manual refetch decisions, and hand-rolled race
// handling - on a fast page switch the older request can resolve last and
// overwrite fresh data with stale data.
//
// TanStack Query handles all of that:
//   - loading / error / data without manual setState
//   - concurrent requests for the same queryKey are deduplicated
//   - returning to a page refetches based on staleness
//   - only the latest request's result is adopted (races solved)
//   - mutations invalidate, lists refetch on their own - no "please refresh"
//     callbacks threaded through components

/** Central queryKey definitions.
 *
 *  This is the single contract the whole cache hangs on: a one-character
 *  typo in a key silently breaks invalidation ("created successfully but
 *  the list didn't refresh"). So keys are never hand-typed as string arrays
 *  in components. */
export const queryKeys = {
  adminEvents: (params: ListEventsParams) => ['admin', 'events', params] as const,
  adminEvent: (uuid: string) => ['admin', 'event', uuid] as const,
  handlers: () => ['admin', 'handlers'] as const,
  publicEvents: () => ['public', 'events'] as const,
  trend: (uuid: string) => ['admin', 'trend', uuid] as const,
};

/** Employee-side list.
 *
 *  placeholderData: keepPreviousData is what makes pagination feel right -
 *  while the next page loads, the previous page's data stays on screen
 *  (no flash to an empty skeleton) and is swapped in when the response
 *  arrives. Without it every page turn visually jumps. */
export const useAdminEvents = (params: ListEventsParams) =>
  useQuery({
    queryKey: queryKeys.adminEvents(params),
    queryFn: () => fetchAdminEvents(params),
    placeholderData: keepPreviousData,
    // Admin data doesn't need second-level freshness. Re-entering the page
    // within 30s serves from cache instead of refetching on every visit.
    staleTime: 30_000,
  });

export const useAdminEvent = (uuid: string | undefined) =>
  useQuery({
    queryKey: queryKeys.adminEvent(uuid ?? ''),
    queryFn: () => fetchAdminEvent(uuid as string),
    // Don't fire until the uuid is actually available from the route.
    enabled: Boolean(uuid),
  });

export const useHandlers = () =>
  useQuery({
    queryKey: queryKeys.handlers(),
    queryFn: fetchHandlers,
    // The handler list barely changes - cache it long so reopening the
    // create form doesn't refetch every time.
    staleTime: 5 * 60_000,
  });

/** Public list. Anyone can open this at any moment, so keep it fresher. */
export const usePublicEvents = () =>
  useQuery({
    queryKey: queryKeys.publicEvents(),
    queryFn: fetchPublicEvents,
    staleTime: 10_000,
  });

/** Trend, cached per uuid. */
export const useEventTrend = (uuid: string | undefined) =>
  useQuery({
    queryKey: queryKeys.trend(uuid ?? ''),
    queryFn: () => fetchEventTrend(uuid as string),
    enabled: Boolean(uuid),
  });

/** Create event.
 *
 *  Two prefixes are invalidated, and both are needed:
 *
 *  ['admin'] marks every cache entry under it stale - the list, the handler
 *  dropdown, any cached detail - so returning to the list always shows fresh
 *  data without the caller wiring up a refresh callback.
 *
 *  ['public'] covers the other direction: a new event is normally open (future
 *  deadline, seats available), so it must appear in the public dropdown right
 *  away. Miss this and the person who just created the event opens the public
 *  page, does not find it, and concludes the create silently failed. The
 *  server side is invalidated on write as well; the two are independent, since
 *  the client cache and the server cache are separate stores. */
export const useCreateEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      void queryClient.invalidateQueries({ queryKey: ['public'] });
    },
  });
};

/** Registration.
 *
 *  On success the public list must refetch - a registration can fill an
 *  event to capacity, and a full event doesn't belong in the dropdown
 *  anymore. The admin list is invalidated too so registration counts are
 *  current. */
export const useRegisterForEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerForEvent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['public'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
};
