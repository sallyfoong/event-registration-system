import { AsyncLocalStorage } from 'async_hooks';

// Every log line should be attributable to the request that produced it.
// Without that, an error in the log tells you *what* broke but not *which
// submission* it broke for - and by the time you look, the user's browser has
// moved on.
//
// AsyncLocalStorage rather than threading a `requestId` parameter through
// every service signature: the alternative is a parameter that exists purely
// for logging, has to be added to every function that might ever log, and is
// easy to forget in exactly the code path that needed it. ALS carries the
// value across awaits without touching a single call site.
//
// Node's ALS propagates through promises and timers, so a log written three
// awaits deep inside a service still sees the id from the HTTP request that
// started it.

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `requestId` visible to anything it calls, however deep. */
export const runWithRequestId = (requestId: string, fn: () => void): void => {
  storage.run({ requestId }, fn);
};

/** The id of the request being served, or undefined outside a request
 *  (startup, the seed script, a background timer). Logging must never throw
 *  because of a missing context, so this returns undefined rather than
 *  asserting. */
export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;
