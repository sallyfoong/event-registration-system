/** Unit tests for the in-process read-through cache.
 *
 *  The cache has no dependencies and no I/O, so everything here is a plain
 *  function call - which is the point of keeping it in utils/ rather than
 *  inline in the service: the four behaviours that matter (hit, expiry,
 *  no-caching-of-errors, bounded size) are testable without a database or an
 *  HTTP request.
 */

import { clear, MAX_ENTRIES, size, wrap } from '../utils/cache';

describe('utils/cache', () => {
  beforeEach(() => {
    clear();
  });

  it('runs the loader on the first read and serves the stored value afterwards', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { items: [1, 2] };
    };

    const first = await wrap('key', 60_000, loader);
    expect(first.hit).toBe(false);
    expect(first.value).toEqual({ items: [1, 2] });

    const second = await wrap('key', 60_000, loader);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual({ items: [1, 2] });
    // One query for two requests - the whole reason the module exists.
    expect(calls).toBe(1);
  });

  it('treats a non-positive TTL as "caching is off"', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    const first = await wrap('off', 0, loader);
    const second = await wrap('off', 0, loader);

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(false);
    expect(calls).toBe(2);
    // Nothing was stored either: an entry with TTL 0 would be born expired.
    expect(size()).toBe(0);
  });

  it('re-runs the loader once the entry has expired', async () => {
    // Date.now is controlled rather than slept: the TTL is a wall-clock
    // comparison, and a real sleep would make the suite slower without making
    // the assertion any stronger.
    const nowSpy = jest.spyOn(Date, 'now');
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    try {
      nowSpy.mockReturnValue(1_000);
      await wrap('expiring', 1_000, loader);

      nowSpy.mockReturnValue(1_500);
      expect((await wrap('expiring', 1_000, loader)).hit).toBe(true);

      // Exactly at the deadline counts as expired: an entry is servable only
      // while expiresAt > now.
      nowSpy.mockReturnValue(2_000);
      const afterExpiry = await wrap('expiring', 1_000, loader);
      expect(afterExpiry.hit).toBe(false);
      expect(afterExpiry.value).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('never stores a rejected load', async () => {
    const loader = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('database is down'))
      .mockResolvedValueOnce('recovered');

    await expect(wrap('error', 60_000, loader)).rejects.toThrow('database is down');

    const retry = await wrap('error', 60_000, loader);
    expect(retry.hit).toBe(false);
    expect(retry.value).toBe('recovered');
  });

  it('hands out copies, so a caller cannot rewrite what the next request sees', async () => {
    const first = await wrap('copy', 60_000, async () => [3, 1, 2]);
    // A caller sorting the array in place is the realistic version of this
    // bug: the cache would then serve a reordered list to everyone else.
    first.value.sort();

    const second = await wrap('copy', 60_000, async () => [9, 9, 9]);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual([3, 1, 2]);
  });

  it('evicts the oldest entry once the cap is reached', async () => {
    for (let i = 0; i <= MAX_ENTRIES; i += 1) {
      await wrap(`key-${i}`, 60_000, async () => i);
    }

    // Never more than the cap, however many keys arrive.
    expect(size()).toBe(MAX_ENTRIES);

    // key-0 was inserted first, so it is the one that had to go.
    const evicted = await wrap('key-0', 60_000, async () => 'reloaded');
    expect(evicted.hit).toBe(false);

    // A later key is untouched.
    const kept = await wrap(`key-${MAX_ENTRIES}`, 60_000, async () => 'reloaded');
    expect(kept.hit).toBe(true);
  });

  it('clear() drops every entry', async () => {
    await wrap('a', 60_000, async () => 1);
    await wrap('b', 60_000, async () => 2);
    expect(size()).toBe(2);

    clear();

    expect(size()).toBe(0);
    expect((await wrap('a', 60_000, async () => 3)).hit).toBe(false);
  });
});
