import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerWorkflow } from "@convex-dev/workflow/test";

/**
 * Register the `@convex-dev/workflow` component (and its nested
 * workpool) into a convex-test instance. Required by any test that
 * reaches `workflow.start` — without registration the call throws
 * `Component 'workflow' is not registered` and the surrounding
 * mutation transaction rolls back, masking the behavior under test.
 */
export function setupExtractionWorkflow<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerWorkflow(ht);
}
