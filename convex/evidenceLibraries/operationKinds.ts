/**
 * What kind of work an operation row records. This module holds no Convex functions, so
 * the triggers can load it.
 */
import type { Doc } from "../_generated/dataModel";

/** A publish operation owned by the configuration deployment pipeline. */
export function isConfigurationDeploymentOperation(
  operation: Doc<"evidenceLibraryConfigOperations">,
): boolean {
  return (
    operation.kind === "publish" &&
    (operation.activationEditVersion !== undefined ||
      operation.runtimeUpdate !== undefined ||
      operation.addressMove !== undefined ||
      operation.domainChange !== undefined)
  );
}

/** An operation the Versions section lists: the library's setup, or a deployment of its configuration or software, with the revision it ran. */
export function isVersionOperation(operation: Doc<"evidenceLibraryConfigOperations">): boolean {
  return operation.revisionId !== undefined && (operation.kind === "setup" || isConfigurationDeploymentOperation(operation));
}
