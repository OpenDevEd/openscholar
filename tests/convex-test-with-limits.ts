/**
 * `convex-test` as the app runs: with Convex's transaction limits on (16 MiB read and
 * written, 32,000 documents scanned, 4,096 index ranges, 16,000 documents written), so a
 * query that fails at full size in production fails in its test too, and with every
 * aggregate from convex/convex.config.ts registered, since a database trigger may write to
 * them from any mutation, and the migrations component. Writes in `t.run` go through the same
 * database triggers as the app's mutations (convex/lib/triggers.ts), so rows a test seeds
 * are counted as rows the app writes. vitest.config.ts aliases `convex-test` to this file;
 * tests import `convex-test` as usual. A test that needs other limits passes
 * `transactionLimits` itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import type { SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerBatchWorker } from "@convex-dev/batch-worker/test";
import { register as registerMigrations } from "@convex-dev/migrations/test";
import { convexTest as baseConvexTest } from "convex-test/dist/index.js";
import { capWrites } from "../convex/lib/capWrites";
import { triggers } from "../convex/lib/triggers";
import { flushCountQueue, type CountQueue } from "../convex/lib/countQueue";

export * from "convex-test/dist/index.js";

// A function scheduled for later on real timers, such as a batch worker's next run, is left
// for later by `finishAllScheduledFunctions`. Its timer then fires during the tests after it,
// running against a finished test's database and slowing them by seconds. Each test's
// leftover timers are cleared when it ends.
const armed = new Set<ReturnType<typeof setTimeout>>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = Object.assign((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const timer = realSetTimeout(() => {
    armed.delete(timer);
    callback(...args);
  }, ms);
  armed.add(timer);
  return timer;
}, realSetTimeout) as typeof setTimeout;
globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
  if (timer) armed.delete(timer);
  realClearTimeout(timer);
}) as typeof clearTimeout;
afterEach(() => {
  for (const timer of armed) realClearTimeout(timer);
  armed.clear();
});

type Schema = SchemaDefinition<any, boolean>;
type Modules = Record<string, () => Promise<any>>;
type Options = Parameters<typeof baseConvexTest>[0] & object;

const isOptions = (value: unknown): value is Options =>
  typeof value === "object" && value !== null && !("tables" in value);

/** The aggregate instances the app uses, as `app.use` names them. */
const config = readFileSync(path.resolve(__dirname, "../convex/convex.config.ts"), "utf8");
const aggregates = [...config.matchAll(/app\.use\(aggregate, \{ name: "(\w+)" \}\)/g)].map(([, name]) => name);

export function convexTest(schemaOrOptions?: Schema | Options, modules?: Modules) {
  const options: Options = isOptions(schemaOrOptions) ? schemaOrOptions : { schema: schemaOrOptions, modules };
  const t = baseConvexTest({ ...options, transactionLimits: options.transactionLimits ?? true } as never) as ReturnType<typeof baseConvexTest>;
  for (const name of aggregates) {
    registerAggregate(t as never, name);
    // The aggregate applies queued writes (`{ async: true }`) with its own batch worker.
    registerBatchWorker(t as never, `${name}/batchWorker`);
  }
  if (/app\.use\(migrations\)/.test(config)) registerMigrations(t as never);
  if (/app\.use\(batchWorker\)/.test(config)) registerBatchWorker(t as never, "batchWorker");
  return withTriggersInRun(t);
}

/**
 * Runs `fn` like `t.run`, without the list caps (convex/lib/capWrites.ts): for seeding rows
 * saved before their cap existed, such as a legacy search's history arrays.
 */
export function runUncapped<T extends { run: (fn: (ctx: any) => Promise<any>) => Promise<any> }, R>(
  t: T,
  fn: (ctx: Parameters<Parameters<T["run"]>[0]>[0]) => Promise<R>,
): Promise<R> {
  return (t as unknown as Runner).runUncapped!(fn) as Promise<R>;
}

/**
 * Runs `fn` like `t.run`, without the database triggers or the list caps: for seeding rows
 * as they were before a trigger kept something on them, such as a job without its sort name.
 */
export function runUntriggered<T extends { run: (fn: (ctx: any) => Promise<any>) => Promise<any> }, R>(
  t: T,
  fn: (ctx: Parameters<Parameters<T["run"]>[0]>[0]) => Promise<R>,
): Promise<R> {
  return (t as unknown as Runner).runUntriggered!(fn) as Promise<R>;
}

type Runner = {
  run: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  withIdentity: (identity: any) => Runner;
  /** Like `run`, without the list caps: for seeding rows saved before their cap existed. */
  runUncapped?: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  /** Like `run`, without the triggers or the caps. */
  runUntriggered?: (fn: (ctx: any) => Promise<any>) => Promise<any>;
};

/**
 * Runs `t.run` callbacks, including under `withIdentity`, with the app's writes: the database
 * triggers over the list caps (convex/lib/capWrites.ts). `t.runUncapped` skips the caps.
 */
function withTriggersInRun<T extends Runner>(target: T): T {
  const run = target.run.bind(target);
  const withIdentity = target.withIdentity.bind(target);
  target.run = (fn) =>
    run(async (ctx) => {
      const countQueue: CountQueue = new Map();
      const result = await fn(triggers.wrapDB({ ...ctx, db: capWrites(ctx.db), countQueue }));
      await flushCountQueue(ctx, countQueue);
      return result;
    });
  target.runUncapped = (fn) => run((ctx) => fn(triggers.wrapDB(ctx)));
  target.runUntriggered = run;
  target.withIdentity = (identity) => withTriggersInRun(withIdentity(identity));
  return target;
}
