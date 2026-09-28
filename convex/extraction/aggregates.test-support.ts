/**
 * Shared test helper: register the job credit total and extraction progress
 * component instances on a `convexTest` handle. Every test that settles a
 * charge against a job, or completes papers, must call this after creating
 * the test handle.
 *
 * The `.test-support.ts` extension (two dots) keeps this file out of the
 * Convex bundler — its import graph pulls in `convex-test` and
 * `@convex-dev/aggregate/test`, which are test-only dependencies.
 */

import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

export function setupAggregates<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  // register() is typed against a loose SchemaDefinition; widening via a
  // direct cast is safe because registerComponent never reads fields off
  // the schema generic.
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerAggregate(ht, "creditsAgg");
  // Tier B (extraction-occ-fixes): per-job processed/failed counters
  // migrated from extractionJobs row fields to a 16-shard counter. Any
  // test that triggers markPaperTerminalTx — i.e., almost every test
  // that exercises paper completion — needs these registered.
  registerShardedCounter(ht, "extractionProcessedCounter");
  registerShardedCounter(ht, "extractionFailedCounter");
}
