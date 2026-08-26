import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  claimAndScheduleConfigurationDeployment,
  requireNoActiveConfigurationDeployment,
} from "./configurationDeployment";
import { queueRuntimeUpdateOperation } from "./operations";
import { isFreshRuntimeRelease } from "./runtimeReleases";

type RunningBinding = Extract<
  Doc<"evidenceLibraryRuntimeBindings">,
  { state: "ready" }
>;

async function requireRunningLibrary(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  const access = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
  const library = access.library;
  const binding = library.runtimeBindingId
    ? await ctx.db.get(library.runtimeBindingId)
    : null;
  if (
    library.state !== "active" ||
    !library.activeRevisionId ||
    !binding ||
    binding.libraryId !== libraryId ||
    binding.state !== "ready" ||
    !("runtimeCommit" in binding)
  ) {
    throw createError("CONFLICT", "This library is not running yet");
  }
  return {
    ...access,
    activeRevisionId: library.activeRevisionId,
    binding: binding as RunningBinding,
  };
}

// Publishes the active revision again at the newest Evidence Library
// software. The owner checks for updates first; the fresh release row is
// the only source of the target commit.
export async function startEvidenceLibraryRuntimeUpdate(
  ctx: MutationCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const running = await requireRunningLibrary(ctx, args.libraryId);
  const from = running.binding.runtimeCommit;
  const release = await ctx.db
    .query("evidenceLibraryRuntimeReleases")
    .withIndex("by_running", (query) => query.eq("running", from))
    .unique();
  if (!release || !isFreshRuntimeRelease(release.checkedAt, Date.now())) {
    throw createError("CONFLICT", "Check for updates before updating");
  }
  if (release.latest === from) {
    throw createError(
      "CONFLICT",
      "This library already runs the latest software",
    );
  }
  await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  const operation = await queueRuntimeUpdateOperation(ctx, {
    libraryId: args.libraryId,
    idempotencyKey: `runtime-update:${from}:${release.latest}`,
    revisionId: running.activeRevisionId,
    runtimeUpdate: { from, to: release.latest },
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return { ...started, from, to: release.latest };
}

export const startRuntimeUpdate = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
    from: v.string(),
    to: v.string(),
  }),
  handler: startEvidenceLibraryRuntimeUpdate,
});
