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
  if (library.state !== "active" || !library.activeRevisionId) return null;

  const setup = await findEvidenceLibrarySetupRecords(ctx, library);
  if (
    !setup ||
    setup.revision._id !== library.activeRevisionId ||
    setup.setupOperation.revisionId !== setup.revision._id ||
    setup.setupOperation.status !== "succeeded" ||
    setup.setupOperation.stage !== "completed" ||
    setup.setupOperation.receipt?.revisionKey !== setup.revision.revisionKey ||
    setup.runtimeBinding.state !== "ready"
  ) {
    return null;
  }

  return setup.runtimeBinding.targetBaseUrl;
}
