/**
 * `convex-test` with Convex's transaction limits on (16 MiB read and written, 32,000
 * documents scanned, 4,096 index ranges, 16,000 documents written), so a query that
 * fails at full size in production fails in its test too. vitest.config.ts aliases
 * `convex-test` to this file; tests import `convex-test` as usual. A test that needs
 * other limits passes `transactionLimits` itself.
 */
import type { SchemaDefinition } from "convex/server";
import { convexTest as baseConvexTest } from "convex-test/dist/index.js";

export * from "convex-test/dist/index.js";

type Schema = SchemaDefinition<any, boolean>;
type Modules = Record<string, () => Promise<any>>;
type Options = Parameters<typeof baseConvexTest>[0] & object;

const isOptions = (value: unknown): value is Options =>
  typeof value === "object" && value !== null && !("tables" in value);

export function convexTest(schemaOrOptions?: Schema | Options, modules?: Modules) {
  const options = isOptions(schemaOrOptions) ? schemaOrOptions : { schema: schemaOrOptions, modules };
  return baseConvexTest({ transactionLimits: true, ...options } as never) as ReturnType<typeof baseConvexTest>;
}
