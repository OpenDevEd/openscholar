import { register as registerAggregate } from "@convex-dev/aggregate/test";
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

export function setupScreeningAggregates<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerAggregate(ht, "screeningResultStatusAgg");
  registerAggregate(ht, "screeningQualifiedAgg");
}
