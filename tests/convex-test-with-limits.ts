/**
 * `convex-test` as the app runs: with Convex's transaction limits on (16 MiB read and
 * written, 32,000 documents scanned, 4,096 index ranges, 16,000 documents written), so a
 * query that fails at full size in production fails in its test too, and with every
 * aggregate and sharded counter from convex/convex.config.ts registered, since a database
 * trigger may write to them from any mutation, and the migrations component. Writes in `t.run` go through the same
 * database triggers as the app's mutations (convex/lib/triggers.ts), so rows a test seeds
 * are counted as rows the app writes. vitest.config.ts aliases `convex-test` to this file;
 * tests import `convex-test` as usual. A test that needs other limits passes
 * `transactionLimits` itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerBatchWorker } from "@convex-dev/batch-worker/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { register as registerMigrations } from "@convex-dev/migrations/test";
import { convexTest as baseConvexTest } from "convex-test/dist/index.js";
import { capWrites } from "../convex/lib/capWrites";
import { triggers } from "../convex/lib/triggers";

export * from "convex-test/dist/index.js";

type Schema = SchemaDefinition<any, boolean>;
type Modules = Record<string, () => Promise<any>>;
type Options = Parameters<typeof baseConvexTest>[0] & object;

const isOptions = (value: unknown): value is Options =>
  typeof value === "object" && value !== null && !("tables" in value);

/** The aggregate and sharded-counter instances the app uses, as `app.use` names them. */
const config = readFileSync(path.resolve(__dirname, "../convex/convex.config.ts"), "utf8");
const components = [...config.matchAll(/app\.use\((aggregate|shardedCounter), \{ name: "(\w+)" \}\)/g)].map(([, kind, name]) => ({ kind, name }));

export function convexTest(schemaOrOptions?: Schema | Options, modules?: Modules) {
  const options: Options = isOptions(schemaOrOptions) ? schemaOrOptions : { schema: schemaOrOptions, modules };
  const t = baseConvexTest({ ...options, transactionLimits: options.transactionLimits ?? true } as never) as ReturnType<typeof baseConvexTest>;
  for (const { kind, name } of components) {
    if (kind === "aggregate") {
      registerAggregate(t as never, name);
      // The aggregate applies queued writes (`{ async: true }`) with its own batch worker.
      registerBatchWorker(t as never, `${name}/batchWorker`);
    } else registerShardedCounter(t as never, name);
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

type Runner = {
  run: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  withIdentity: (identity: any) => Runner;
  /** Like `run`, without the list caps: for seeding rows saved before their cap existed. */
  runUncapped?: (fn: (ctx: any) => Promise<any>) => Promise<any>;
};

/**
 * Runs `t.run` callbacks, including under `withIdentity`, with the app's writes: list caps
 * (convex/lib/capWrites.ts), then the database triggers. `t.runUncapped` skips the caps.
 */
function withTriggersInRun<T extends Runner>(target: T): T {
  const run = target.run.bind(target);
  const withIdentity = target.withIdentity.bind(target);
  target.run = (fn) => run((ctx) => {
    const withTriggers = triggers.wrapDB(ctx);
    return fn({ ...withTriggers, db: capWrites(withTriggers.db) });
  });
  target.runUncapped = (fn) => run((ctx) => fn(triggers.wrapDB(ctx)));
  target.withIdentity = (identity) => withTriggersInRun(withIdentity(identity));
  return target;
}
