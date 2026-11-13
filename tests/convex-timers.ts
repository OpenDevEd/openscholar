/**
 * A function scheduled for later on real timers, such as a batch worker's next run, is left for
 * later by `finishAllScheduledFunctions`. Its timer then fires during the tests after it, running
 * against a finished test's database and slowing them by seconds. Each test's leftover timers are
 * cleared when it ends. Test files share a worker, so timers are wrapped once per worker.
 */
import { afterAll, afterEach } from "vitest";

type Timer = ReturnType<typeof setTimeout>;
type Armed = { timers: Set<Timer>; clear: typeof clearTimeout; set: typeof setTimeout };
type Backend = { finishInProgressScheduledFunctions: () => Promise<void> };
const worker = globalThis as typeof globalThis & { __armedTimers?: Armed; __convexBackends?: Set<WeakRef<Backend>> };

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
  worker.__armedTimers = { timers, clear: realClearTimeout, set: realSetTimeout };
}

const armed = worker.__armedTimers;
const clearLeftovers = () => {
  for (const timer of armed.timers) armed.clear(timer);
  armed.timers.clear();
};
afterEach(clearLeftovers);

/** How long a file waits for the scheduled functions it started: one waiting on a faked timer never ends. */
const DRAIN_MS = 2_000;

/**
 * A scheduled function already running when its test file ends can be in the middle of loading a module. Vitest
 * rejects every load still pending as the file closes, and test files share their modules, so each later file in
 * the worker that needs that module fails with "after the environment was torn down": dozens of unrelated tests at
 * once. Each file waits for the functions it started before it ends, and for the ones those start in turn.
 */
afterAll(async () => {
  const started = [...(worker.__convexBackends ?? [])].flatMap((ref) => ref.deref() ?? []);
  worker.__convexBackends?.clear();
  const drained = (async () => {
    for (let round = 0; round < 3; round++) {
      await Promise.allSettled(started.map((backend) => backend.finishInProgressScheduledFunctions()));
      clearLeftovers();
    }
  })();
  await Promise.race([drained, new Promise((resolve) => armed.set(resolve, DRAIN_MS))]);
});
