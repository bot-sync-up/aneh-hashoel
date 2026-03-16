import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useLocalStorage — React hook for persisting state in localStorage.
 *
 * Automatically JSON-serializes values on write and deserializes on read.
 * Synchronises across browser tabs via the "storage" event.
 *
 * @template T
 * @param {string} key            — localStorage key
 * @param {T}      [initialValue] — default value when the key does not exist
 *
 * @returns {[T, (value: T | ((prev: T) => T)) => void, () => void]}
 *   [storedValue, setValue, removeValue]
 *
 * Usage:
 *   const [theme, setTheme, removeTheme] = useLocalStorage('theme', 'light');
 *   setTheme('dark');
 *   setTheme(prev => prev === 'dark' ? 'light' : 'dark'); // functional update
 *   removeTheme(); // clears the key
 */
function useLocalStorage(key, initialValue) {
  // Keep a stable ref to `initialValue` to avoid re-running the lazy init
  const initialValueRef = useRef(initialValue);

  const readValue = useCallback(() => {
    if (typeof window === 'undefined') return initialValueRef.current;

    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValueRef.current;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`[useLocalStorage] Could not read key "${key}":`, error);
      return initialValueRef.current;
    }
  }, [key]);

  const [storedValue, setStoredValue] = useState(readValue);

  const setValue = useCallback(
    (value) => {
      if (typeof window === 'undefined') {
        console.warn(
          `[useLocalStorage] Cannot set key "${key}" — window is not available.`
        );
        return;
      }

      try {
        setStoredValue((prev) => {
          const nextValue =
            typeof value === 'function' ? value(prev) : value;

          window.localStorage.setItem(key, JSON.stringify(nextValue));

          // Dispatch a custom event so other hooks on the same key
          // in the same tab can react (the native "storage" event only
          // fires in other tabs).
          window.dispatchEvent(
            new CustomEvent('useLocalStorage', { detail: { key, newValue: nextValue } })
          );

          return nextValue;
        });
      } catch (error) {
        console.warn(`[useLocalStorage] Could not set key "${key}":`, error);
      }
    },
    [key]
  );

  const removeValue = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.removeItem(key);
      setStoredValue(initialValueRef.current);
      window.dispatchEvent(
        new CustomEvent('useLocalStorage', {
          detail: { key, newValue: undefined },
        })
      );
    } catch (error) {
      console.warn(`[useLocalStorage] Could not remove key "${key}":`, error);
    }
  }, [key]);

  // Sync state when another tab changes the same key (native storage event)
  useEffect(() => {
    const handleStorageEvent = (e) => {
      if (e.key === key) {
        setStoredValue(readValue());
      }
    };

    // Also handle the custom same-tab event from other instances of the hook
    const handleCustomEvent = (e) => {
      if (e.detail?.key === key) {
        setStoredValue(
          e.detail.newValue !== undefined
            ? e.detail.newValue
            : initialValueRef.current
        );
      }
    };

    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('useLocalStorage', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('useLocalStorage', handleCustomEvent);
    };
  }, [key, readValue]);

  return [storedValue, setValue, removeValue];
}

export default useLocalStorage;
