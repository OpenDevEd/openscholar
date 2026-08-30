import type { Doc } from "../_generated/dataModel";
import { isRuntimeImageReference } from "./runtimeImageRegistry";

type Operation = Doc<"evidenceLibraryConfigOperations">;

export type RuntimeImageOperationCleanup = Partial<
  Pick<
    Operation,
    | "configurationDeploymentTarget"
    | "receipt"
    | "runtimeUpdate"
    | "setupReceipts"
    | "setupRuntimeCommit"
    | "setupRuntimeImage"
  >
>;

function hasReleasePair(commit: unknown, image: unknown): boolean {
  return (
    typeof commit === "string" &&
    /^[a-f0-9]{40}$/u.test(commit) &&
    typeof image === "string" &&
    isRuntimeImageReference(image)
  );
}

function omitReleasePair(receipt: NonNullable<Operation["receipt"]>) {
  const {
    runtimeCommit: _runtimeCommit,
    runtimeImage: _runtimeImage,
    ...rest
  } = receipt;
  return rest;
}

function omitOldSetupDeploymentReceipts(
  receipts: NonNullable<Operation["setupReceipts"]>,
) {
  const {
    application: _application,
    deployment: _deployment,
    health_check: _healthCheck,
    ...rest
  } = receipts;
  return rest;
}

/**
 * Returns the exact patch for terminal pre-image recovery state. Running work
 * is never rewritten because its saved target may still be needed to recover.
 */
export function planRuntimeImageOperationCleanup(
  operation: Operation,
): RuntimeImageOperationCleanup | null {
  const targetIncomplete =
    operation.configurationDeploymentTarget !== undefined &&
    !hasReleasePair(
      operation.configurationDeploymentTarget.runtimeCommit,
      operation.configurationDeploymentTarget.runtimeImage,
    );
  const updateIncomplete =
    operation.runtimeUpdate !== undefined &&
    (!hasReleasePair(
      operation.runtimeUpdate.from,
      operation.runtimeUpdate.fromImage,
    ) ||
      !hasReleasePair(
        operation.runtimeUpdate.to,
        operation.runtimeUpdate.toImage,
      ));
  const receiptHasReleaseValue =
    operation.receipt?.runtimeCommit !== undefined ||
    operation.receipt?.runtimeImage !== undefined;
  const receiptIncomplete =
    receiptHasReleaseValue &&
    !hasReleasePair(
      operation.receipt?.runtimeCommit,
      operation.receipt?.runtimeImage,
    );
  const setupReceiptsIncomplete =
    (operation.setupReceipts?.application !== undefined &&
      !hasReleasePair(
        operation.setupReceipts.application.runtimeCommit,
        operation.setupReceipts.application.runtimeImage,
      )) ||
    (operation.setupReceipts?.deployment !== undefined &&
      !hasReleasePair(
        operation.setupReceipts.deployment.runtimeCommit,
        operation.setupReceipts.deployment.runtimeImage,
      ));
  const setupReleaseIncomplete =
    (operation.setupRuntimeCommit !== undefined ||
      operation.setupRuntimeImage !== undefined) &&
    !hasReleasePair(operation.setupRuntimeCommit, operation.setupRuntimeImage);

  const incomplete =
    targetIncomplete ||
    updateIncomplete ||
    receiptIncomplete ||
    setupReceiptsIncomplete ||
    setupReleaseIncomplete;
  if (!incomplete) return null;
  if (operation.status === "queued" || operation.status === "running") {
    throw new Error(
      `Operation ${operation._id} is still active with incomplete runtime image identity`,
    );
  }

  const patch: RuntimeImageOperationCleanup = {};
  if (targetIncomplete) patch.configurationDeploymentTarget = undefined;
  if (updateIncomplete) patch.runtimeUpdate = undefined;
  if (receiptIncomplete && operation.receipt) {
    patch.receipt = omitReleasePair(operation.receipt);
  }
  if (setupReceiptsIncomplete && operation.setupReceipts) {
    patch.setupReceipts = omitOldSetupDeploymentReceipts(
      operation.setupReceipts,
    );
  }
  if (setupReleaseIncomplete) {
    patch.setupRuntimeCommit = undefined;
    patch.setupRuntimeImage = undefined;
  }
  return patch;
}

export function requireProvisionedRuntimeImage(
  binding: Doc<"evidenceLibraryRuntimeBindings">,
): void {
  if (!("targetRuntimeId" in binding)) return;
  if (!hasReleasePair(binding.runtimeCommit, binding.runtimeImage)) {
    throw new Error(
      `Runtime binding ${binding._id} is provisioned without an exact release pair`,
    );
  }
}
