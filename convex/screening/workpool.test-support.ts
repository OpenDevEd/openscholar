import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerWorkpool } from "@convex-dev/workpool/test";

export function setupScreeningWorkpool<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerWorkpool(ht, "screeningWorkpool");
  registerWorkpool(ht, "screeningAnswersWorkpool");
}
