import type { Doc, Id } from "../_generated/dataModel";
import {
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  isEvidenceLibraryAddressFree,
  readEvidenceLibraryAddressCandidates,
  type EvidenceLibraryAddressCandidate,
} from "./setupNaming";
import {
  loadDraftConfigurationSnapshot,
  loadRevisionConfigurationSnapshot,
  persistDraftConfigurationSnapshot,
} from "./configurationSnapshot";
import { validateSectionPayload } from "./sectionPayload";

type AddressRecoveryCtx = QueryCtx | MutationCtx;

export const evidenceLibraryAddressCandidateValidator = v.object({
  publicAddress: v.string(),
  slug: v.string(),
});

export const evidenceLibraryMoveCandidatesValidator = v.object({
  currentAddress: v.string(),
  candidates: v.array(evidenceLibraryAddressCandidateValidator),
});

/** The address the library is on now, and the ones it could move to. */
async function readMoveCandidates(
  ctx: AddressRecoveryCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library) {
    throw createError("NOT_FOUND", "Evidence Library not found");
  }
  const binding = library.runtimeBindingId
    ? await ctx.db.get(
        "evidenceLibraryRuntimeBindings",
        library.runtimeBindingId,
      )
    : null;
  if (!binding) {
    throw createError("CONFLICT", "This library has no address yet");
  }
  const { candidates } = await readEvidenceLibraryAddressCandidates(ctx, {
    organizationId: library.organizationId,
    name: library.name,
  });
  return {
    currentAddress: binding.targetBaseUrl,
    // The address it sits on now is not a move.
    candidates: candidates.filter(
      (candidate) => candidate.publicAddress !== binding.targetBaseUrl,
    ),
  };
}

/**
 * Candidates for a move the platform starts by itself, during setup. There is
 * no signed-in owner: the deploy pipeline found another site on the address.
 */
export const readPlatformMoveCandidates = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: evidenceLibraryMoveCandidatesValidator,
  handler: async (ctx, args) => await readMoveCandidates(ctx, args.libraryId),
});

/** Candidates for a move an owner asked for. */
export const readOwnerMoveCandidates = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: evidenceLibraryMoveCandidatesValidator,
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return await readMoveCandidates(ctx, args.libraryId);
  },
});

/**
 * The address a move may take. The shared check already asked Coolify and the
 * host itself; this is the last look at our own database, inside the
 * transaction that writes the move.
 */
export async function requireFreeEvidenceLibraryAddress(
  ctx: AddressRecoveryCtx,
  args: {
    library: Doc<"evidenceLibraries">;
    candidate: EvidenceLibraryAddressCandidate;
  },
): Promise<string> {
  const free = await isEvidenceLibraryAddressFree(ctx, {
    organizationId: args.library.organizationId,
    publicAddress: args.candidate.publicAddress,
    slug: args.candidate.slug,
  });
  if (!free) {
    throw createError(
      "CONFLICT",
      "Another Evidence Library took that address first",
    );
  }
  return args.candidate.publicAddress;
}

export async function moveIdentityBaseUrl(
  ctx: MutationCtx,
  section: Doc<"evidenceLibraryConfigSections"> | null,
  nextAddress: string,
  migratedPayload?: unknown,
) {
  if (!section) return;
  const payload = migratedPayload ?? section.payload;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library identity configuration is invalid",
    );
  }
  if ((payload as Record<string, unknown>).baseUrl === nextAddress) return;
  const nextPayload = {
    ...(payload as Record<string, unknown>),
    baseUrl: nextAddress,
  };
  await ctx.db.patch(section._id, {
    payload: nextPayload,
    payloadByteLength: validateSectionPayload(nextPayload),
    ...(section.kind === "draft" ? { updatedAt: Date.now() } : {}),
  });
  if (section.kind === "draft") {
    const draft = await ctx.db.get(section.draftId);
    if (!draft) throw createError("NOT_FOUND", "Evidence Library draft not found");
    await ctx.db.patch(draft._id, {
      editVersion: draft.editVersion + 1,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Points the library at a new address: the runtime binding, the draft the
 * owner edits, and the revision that is being deployed all carry it.
 */
export async function applyEvidenceLibraryAddressMove(
  ctx: MutationCtx,
  args: {
    bindingId: Id<"evidenceLibraryRuntimeBindings">;
    draftId: Id<"evidenceLibraryConfigDrafts">;
    revisionId?: Id<"evidenceLibraryConfigRevisions">;
    nextAddress: string;
    /** Setup also moves its pending revision before the first deployment. */
    updateRevision?: boolean;
  },
): Promise<void> {
  const binding = await ctx.db.get(
    "evidenceLibraryRuntimeBindings",
    args.bindingId,
  );
  if (!binding) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding not found",
    );
  }
  const updateRevision = args.updateRevision === true;
  if (updateRevision && !args.revisionId) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library setup revision is missing",
    );
  }
  const draftSnapshot = await loadDraftConfigurationSnapshot(ctx, args.draftId, {
    requireComplete: false,
  });
  await persistDraftConfigurationSnapshot(ctx, draftSnapshot);
  const persistedDraft = await loadDraftConfigurationSnapshot(ctx, args.draftId, {
    requireComplete: false,
  });
  const draftIdentity = persistedDraft.sections.find(
    (section) => section.sectionKey === "identity",
  );
  const revisionSnapshot = updateRevision && args.revisionId
    ? await loadRevisionConfigurationSnapshot(ctx, args.revisionId, {
        requireComplete: true,
      })
    : null;
  const revisionIdentity = revisionSnapshot?.sections.find(
    (section) => section.sectionKey === "identity",
  );
  await ctx.db.patch(args.bindingId, {
    targetBaseUrl: args.nextAddress,
    updatedAt: Date.now(),
  });
  // A library whose owner made a custom domain primary keeps calling that
  // domain its address. Only the platform address moves here.
  if (binding?.canonicalBaseUrl !== undefined) return;
  await moveIdentityBaseUrl(
    ctx,
    draftIdentity ?? null,
    args.nextAddress,
    persistedDraft.migration.snapshot.sections.find(
      (section) => section.sectionKey === "identity",
    )?.payload,
  );
  if (updateRevision) {
    await moveIdentityBaseUrl(
      ctx,
      revisionIdentity ?? null,
      args.nextAddress,
      revisionSnapshot?.migration.snapshot.sections.find(
        (section) => section.sectionKey === "identity",
      )?.payload,
    );
  }
}
