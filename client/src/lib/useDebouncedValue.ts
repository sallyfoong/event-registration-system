import { useEffect, useState } from 'react';

/** Delays exposing a fast-changing value.
 *
 *  Built for the search box: a request per keystroke means one cache entry
 *  per keystroke under TanStack Query - wasted traffic and an exploding
 *  set of cache keys. Waiting 300ms means only a real pause fires a request.
 *
 *  Not lodash.debounce: what's needed here is a value, not a function, and
 *  effect + setTimeout is eight lines - not worth a new dependency. */
export const useDebouncedValue = <T>(value: T, delayMs = 300): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // The cleanup is essential: if the value changes again within the
    // window, the previous timer must be cancelled, or intermediate values
    // each trigger a state update (and therefore a request).
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};
