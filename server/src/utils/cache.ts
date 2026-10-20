/** Process-local read-through cache with a time-to-live, backed by a Map.
 *
 *  Why in-process and not Redis: this deployment is a single container, and
 *  the data being cached is a handful of small read-only lists that a handful
 *  of people look at. Adding Redis would introduce a second service to run,
 *  monitor, secure and back up in exchange for saving a query that already
 *  runs in single-digit milliseconds. The trade-off is stated plainly so it
 *  can be revisited rather than inherited:
 *
 *    - every instance keeps its own copy, so N instances means N independent
 *      caches and at most N queries per TTL window (not one);
 *    - a write only clears the cache of the process that served it. The other
 *      instances keep serving stale data until their entries expire, which is
 *      why the TTL is deliberately short (seconds, not minutes) - the TTL, not
 *      the invalidation, is what bounds staleness across instances.
 *
 *  If either property ever becomes unacceptable (multi-instance deployment
 *  with a strict read-your-writes requirement), this module is the only thing
 *  that has to change: callers only know `wrap` / `clear`.
 */

interface CacheEntry {
  /** A structural copy of what the loader returned - see `wrap` for why. */
  value: unknown;
  /** Epoch milliseconds after which the entry must not be served. */
  expiresAt: number;
}

/** Hard ceiling on entries. Each entry is a small list of DTOs, so this is a
 *  few hundred kilobytes at worst. The point isn't memory pressure, it's that
 *  an unbounded Map keyed partly by user input (search terms, page numbers)
 *  is a slow memory leak: a script walking page=1..1000000 would otherwise
 *  add an entry per request and never release one. */
export const MAX_ENTRIES = 500;

/** Map keeps insertion order, which is exactly the recency order needed for
 *  "evict the oldest entry" - no separate LRU bookkeeping. */
const store = new Map<string, CacheEntry>();

/** Result of a read-through, including whether the loader actually ran.
 *  `hit` is returned rather than inferred by the caller because only this
 *  module knows whether caching was even switched on. */
export interface CacheResult<T> {
  value: T;
  hit: boolean;
}

/** Drops the oldest entries until the store fits inside MAX_ENTRIES.
 *  A `while` loop rather than a single `if`: the ceiling is a constant today,
 *  but the invariant ("never exceed MAX_ENTRIES") should hold even if that
 *  constant is lowered later. */
const evictOldest = (): void => {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
};

/** Read-through: serve the cached value when one is still fresh, otherwise
 *  run `loader` and remember its result.
 *
 *  Contract details that callers depend on:
 *    1. `ttlMs <= 0` means "caching is off" - the loader always runs and the
 *       result is never stored. The test suite relies on this: a cached read
 *       would leak state between cases that reuse the same tables.
 *    2. A rejected loader is never cached. Caching an error would turn a
 *       one-off failure into a TTL-long outage - the exact opposite of what a
 *       cache is for. Because the store only happens after `await loader()`,
 *       a throw skips it by construction, not by a `try`/`catch` someone can
 *       later delete.
 *    3. Values are stored and returned as structural copies. The cached object
 *       is shared by every request in the TTL window; without the copy, one
 *       caller sorting the returned array in place (or tagging a field onto a
 *       DTO) would silently rewrite what the next request sees. The payloads
 *       here are tiny, so copying is cheaper than the bug it prevents.
 */
export const wrap = async <T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<CacheResult<T>> => {
  if (ttlMs <= 0) {
    return { value: await loader(), hit: false };
  }

  const now = Date.now();
  const cached = store.get(key);

  if (cached) {
    if (cached.expiresAt > now) {
      return { value: structuredClone(cached.value) as T, hit: true };
    }
    // Expired entries are removed on access as well as by TTL check, so a key
    // that stops being requested doesn't sit in the Map forever.
    store.delete(key);
  }

  const value = await loader();
  store.set(key, { value: structuredClone(value), expiresAt: now + ttlMs });
  evictOldest();
  return { value, hit: false };
};

/** Forget everything. Called after any write that can change a cached read.
 *
 *  Deliberately coarse: dropping five entries costs one query each on the next
 *  request, while tracking which keys a given write affects costs a mapping
 *  that will be wrong the first time a new cached read is added. Invalidation
 *  bugs are invisible (the UI shows yesterday's numbers); over-invalidation is
 *  merely a couple of extra queries.
 */
export const clear = (): void => {
  store.clear();
};

/** Current number of entries, exposed for tests and diagnostics only.
 *  Not used by production code - nothing should branch on cache size. */
export const size = (): number => store.size;
