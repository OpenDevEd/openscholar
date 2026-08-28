import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

type SetupReadCtx = Pick<QueryCtx | MutationCtx, "db">;

function incompleteSetup(): never {
  throw createError(
    "INVALID_DATA",
    "Evidence Library setup links are incomplete",
  );
}

export async function readEvidenceLibrarySetupRecords(
  ctx: SetupReadCtx,
  library: Doc<"evidenceLibraries">,
) {
  const setup = await findEvidenceLibrarySetupRecords(ctx, library);
  if (!setup) return incompleteSetup();
  return setup;
}

export async function findEvidenceLibrarySetupRecords(
  ctx: SetupReadCtx,
  library: Doc<"evidenceLibraries">,
) {
  const { draftId, latestRevisionId, runtimeBindingId, setupOperationId } =
    library;
  if (!draftId || !latestRevisionId || !runtimeBindingId || !setupOperationId) {
    return null;
  }

  const [draft, revision, runtimeBinding, setupOperation] = await Promise.all([
    ctx.db.get("evidenceLibraryConfigDrafts", draftId),
    ctx.db.get("evidenceLibraryConfigRevisions", latestRevisionId),
    ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId),
    ctx.db.get("evidenceLibraryConfigOperations", setupOperationId),
  ]);
  if (
    !draft ||
    draft.libraryId !== library._id ||
    draft.baseRevisionId !== latestRevisionId ||
    !revision ||
    revision.libraryId !== library._id ||
    !runtimeBinding ||
    runtimeBinding.libraryId !== library._id ||
    !setupOperation ||
    setupOperation.libraryId !== library._id ||
    setupOperation.kind !== "setup"
  ) {
    return null;
  }

  return {
    draft,
    library,
    publicAddress: runtimeBinding.targetBaseUrl,
    revision,
    runtimeBinding,
    setupOperation,
  };
}

export async function readEvidenceLibraryAdminLaunchTarget(
  ctx: SetupReadCtx,
  library: Doc<"evidenceLibraries">,
): Promise<string | null> {
  const { activeRevisionId, activeDeploymentOperationId, runtimeBindingId } =
    library;
  if (
    library.state !== "active" ||
    !activeRevisionId ||
    !runtimeBindingId ||
    !activeDeploymentOperationId
  ) {
    return null;
  }

  const [activeRevision, runtimeBinding, deploymentOperation] =
    await Promise.all([
      ctx.db.get("evidenceLibraryConfigRevisions", activeRevisionId),
      ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId),
      ctx.db.get(
        "evidenceLibraryConfigOperations",
        activeDeploymentOperationId,
      ),
    ]);
  if (
    !activeRevision ||
    activeRevision.libraryId !== library._id ||
    !runtimeBinding ||
    runtimeBinding.libraryId !== library._id ||
    runtimeBinding.state !== "ready" ||
    !deploymentOperation ||
    deploymentOperation.libraryId !== library._id ||
    (deploymentOperation.kind !== "setup" &&
      deploymentOperation.kind !== "publish") ||
    deploymentOperation.revisionId !== activeRevision._id ||
    deploymentOperation.status !== "succeeded" ||
    deploymentOperation.stage !== "completed" ||
    deploymentOperation.receipt?.revisionKey !== activeRevision.revisionKey ||
    !deploymentOperation.receipt.runtimeReceiptId ||
    deploymentOperation.receipt.activatedAt === undefined
  ) {
    return null;
  }

  // The address the library calls its own: a custom domain the owner made
  // primary, otherwise the platform address.
  return runtimeBinding.canonicalBaseUrl ?? runtimeBinding.targetBaseUrl;
}
