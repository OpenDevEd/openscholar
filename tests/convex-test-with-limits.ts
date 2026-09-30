/**
 * `convex-test` as the app runs: with Convex's transaction limits on (16 MiB read and
 * written, 32,000 documents scanned, 4,096 index ranges, 16,000 documents written), so a
 * query that fails at full size in production fails in its test too, and with every
 * aggregate and sharded counter from convex/convex.config.ts registered, since a database
 * trigger may write to them from any mutation. Writes in `t.run` go through the same
 * database triggers as the app's mutations (convex/lib/triggers.ts), so rows a test seeds
 * are counted as rows the app writes. vitest.config.ts aliases `convex-test` to this file;
 * tests import `convex-test` as usual. A test that needs other limits passes
 * `transactionLimits` itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { convexTest as baseConvexTest } from "convex-test/dist/index.js";
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
  for (const { kind, name } of components) (kind === "aggregate" ? registerAggregate : registerShardedCounter)(t as never, name);
  return withTriggersInRun(t);
}

type Runner = { run: (fn: (ctx: any) => Promise<any>) => Promise<any>; withIdentity: (identity: any) => Runner };

/** Runs `t.run` callbacks, including under `withIdentity`, with the database triggers applied. */
function withTriggersInRun<T extends Runner>(target: T): T {
  const run = target.run.bind(target);
  const withIdentity = target.withIdentity.bind(target);
  target.run = (fn) => run((ctx) => fn(triggers.wrapDB(ctx)));
  target.withIdentity = (identity) => withTriggersInRun(withIdentity(identity));
  return target;
}
