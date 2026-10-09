/**
 * A function scheduled for later on real timers, such as a batch worker's next run, is left for
 * later by `finishAllScheduledFunctions`. Its timer then fires during the tests after it, running
 * against a finished test's database and slowing them by seconds. Each test's leftover timers are
 * cleared when it ends. Test files share a worker, so timers are wrapped once per worker.
 */
import { afterEach } from "vitest";

type Timer = ReturnType<typeof setTimeout>;
type Armed = { timers: Set<Timer>; clear: typeof clearTimeout };
const worker = globalThis as typeof globalThis & { __armedTimers?: Armed };

if (!worker.__armedTimers) {
  const timers = new Set<Timer>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = Object.assign((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const timer = realSetTimeout(() => {
      timers.delete(timer);
      callback(...args);
    }, ms);
    timers.add(timer);
    return timer;
  }, realSetTimeout) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: Timer) => {
    if (timer) timers.delete(timer);
    realClearTimeout(timer);
  }) as typeof clearTimeout;
  worker.__armedTimers = { timers, clear: realClearTimeout };
}

const armed = worker.__armedTimers;
afterEach(() => {
  for (const timer of armed.timers) armed.clear(timer);
  armed.timers.clear();
});
