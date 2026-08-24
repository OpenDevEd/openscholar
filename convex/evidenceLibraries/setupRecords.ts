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
  const { draftId, latestRevisionId, runtimeBindingId, setupOperationId } =
    library;
  if (!draftId || !latestRevisionId || !runtimeBindingId || !setupOperationId) {
    return incompleteSetup();
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
    return incompleteSetup();
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
