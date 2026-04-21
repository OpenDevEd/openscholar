/**
 * Shared test helper: register the three @convex-dev/aggregate component
 * instances on a `convexTest` handle. Every test that exercises the live
 * dual-write path (saveExtractionResultsAndComplete or
 * deleteExtractionInternal via the cascade) MUST call this after
 * creating the test handle, or the component runtime will reject the
 * inserts/deletes with `Component "resultStatusAgg" is not registered`.
 *
 * The `.test-support.ts` extension (two dots) keeps this file out of the
 * Convex bundler — its import graph pulls in `convex-test` and
 * `@convex-dev/aggregate/test`, which are test-only dependencies.
 */

import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";

export function setupAggregates<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  // register() is typed against a loose SchemaDefinition; widening via a
  // direct cast is safe because registerComponent never reads fields off
  // the schema generic.
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerAggregate(ht, "resultStatusAgg");
  registerAggregate(ht, "resultAnsweredAgg");
  registerAggregate(ht, "resultConfidenceAgg");
  registerAggregate(ht, "creditsAgg");
  // Billing-txn facet-count aggregates (plans/billing-transactions-perf/01).
  // Registered here because every extraction mutation transitively invokes
  // deductCredits, which writes to creditTransactions and therefore
  // triggers recordTransactionCounters.
  registerAggregate(ht, "txnTypeAgg");
  registerAggregate(ht, "txnCreditPoolAgg");
  registerAggregate(ht, "txnBillingTypeAgg");
}
