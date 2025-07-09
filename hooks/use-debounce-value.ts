import * as React from "react";

/**
 * useDebounceValue – returns a debounced copy of the provided value.
 * The value will only update after `delay` ms have elapsed without further changes.
 */
export function useDebounceValue<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
} 