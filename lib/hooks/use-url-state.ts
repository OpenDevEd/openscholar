import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for syncing state with URL query parameters
 */
export function useUrlState<T>(
  key: string,
  defaultValue: T,
  serialize: (value: T) => string = JSON.stringify,
  deserialize: (value: string) => T = JSON.parse
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValueInternal] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;

    try {
      const params = new URLSearchParams(window.location.search);
      const urlValue = params.get(key);
      if (!urlValue) return defaultValue;
      return deserialize(urlValue);
    } catch (error) {
      console.error(`Error deserializing URL state for key "${key}":`, error);
      return defaultValue;
    }
  });

  const setValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValueInternal(prev => {
      const nextValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prev) : newValue;
      return nextValue;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);

      // Check if value is default
      const isDefaultValue = JSON.stringify(value) === JSON.stringify(defaultValue);

      if (isDefaultValue) {
        params.delete(key);
      } else {
        params.set(key, serialize(value));
      }

      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;

      window.history.replaceState({}, '', newUrl);
    } catch (error) {
      console.error(`Error serializing URL state for key "${key}":`, error);
    }
  }, [value, key, defaultValue, serialize]);

  return [value, setValue];
}
