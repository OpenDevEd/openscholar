/**
 * Shared test helper: register the three @convex-dev/aggregate component
 * instances backing the billing-transactions facet-count badges
 * (plans/billing-transactions-perf/01). Every test that exercises a
 * mutation writing to `creditTransactions` (deductCredits, grantMonthly,
 * addCredits, etc.) MUST call this after creating the test handle, or the
 * component runtime will reject the inserts with
 * `Component "txnTypeAgg" is not registered`.
 *
 * The `.test-support.ts` extension (two dots) keeps this file out of the
 * Convex bundler — its import graph pulls in `convex-test` and
 * `@convex-dev/aggregate/test`, which are test-only dependencies.
 */

import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";

export function setupTransactionAggregates<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerAggregate(ht, "txnTypeAgg");
  registerAggregate(ht, "txnCreditPoolAgg");
  registerAggregate(ht, "txnBillingTypeAgg");
}
