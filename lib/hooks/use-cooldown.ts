import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Returns a boolean that flips to `true` for `ms` milliseconds
 * after `trigger()` is called. Calling `trigger()` again resets the timer.
 */
export function useCooldown(ms = 2000) {
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);
  const active = useRef(false);
  const listeners = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listeners.current.add(cb);
    return () => { listeners.current.delete(cb); };
  }, []);

  const notify = () => listeners.current.forEach((cb) => cb());

  const trigger = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    active.current = true;
    notify();
    timeout.current = setTimeout(() => {
      active.current = false;
      notify();
    }, ms);
  }, [ms]);

  const isCoolingDown = useSyncExternalStore(
    subscribe,
    () => active.current,
    () => false,
  );

  return [isCoolingDown, trigger] as const;
}
