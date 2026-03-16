import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useDebounce — returns a debounced version of `value`.
 *
 * @param {any} value     — value to debounce
 * @param {number} delay  — debounce delay in ms (default 400)
 * @returns the debounced value
 *
 * Usage:
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebounce(search, 400);
 *
 *   useEffect(() => {
 *     if (debouncedSearch) fetchResults(debouncedSearch);
 *   }, [debouncedSearch]);
 */
export function useDebounce(value, delay = 400) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useDebouncedCallback — returns a debounced callback function.
 *
 * @param {Function} fn    — callback to debounce
 * @param {number} delay   — debounce delay in ms (default 400)
 * @param {any[]} deps     — dependency array for the callback
 * @returns [debouncedFn, cancel]
 *
 * Usage:
 *   const [handleSearch, cancelSearch] = useDebouncedCallback(
 *     (query) => api.get('/search', { params: { q: query } }),
 *     500
 *   );
 */
export function useDebouncedCallback(fn, delay = 400, deps = []) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);

  // Keep fnRef current without re-creating the debounced function
  useEffect(() => {
    fnRef.current = fn;
  }, [fn, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedFn = useCallback(
    (...args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [debouncedFn, cancel];
}

/**
 * useThrottle — returns a throttled version of `value`.
 * Useful for scroll / resize event handlers.
 *
 * @param {any} value
 * @param {number} interval — throttle interval in ms (default 200)
 */
export function useThrottle(value, interval = 200) {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdated = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();
    const remaining = interval - (now - lastUpdated.current);

    if (remaining <= 0) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

export default useDebounce;
