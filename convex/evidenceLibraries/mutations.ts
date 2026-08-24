import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createError } from "../lib/errors";
import {
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";
import { nextDraftEditVersion } from "./draftVersion";
import { queueEvidenceLibraryOperation } from "./operations";
import {
  createPendingRuntimeBinding,
  validateTargetBaseUrl,
} from "./provisioning";
import {
  assertDraftPayloadBudget,
  assertNoCredentialMaterial,
  validateSectionPayload,
} from "./sectionPayload";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import { sectionKeyValidator, type SectionKey } from "./validators";

const SETUP_OPERATION_IDEMPOTENCY_KEY = "library-setup";

function toSetupDraftResult(
  setup: Awaited<ReturnType<typeof readEvidenceLibrarySetupRecords>>,
) {
  if (setup.library.state !== "provisioning") {
    throw createError(
      "CONFLICT",
      "Evidence Library setup is no longer a draft",
    );
  }
  return {
    draftId: setup.draft._id,
    editVersion: setup.draft.editVersion,
    libraryId: setup.library._id,
    publicAddress: setup.publicAddress,
    revisionId: setup.revision._id,
    runtimeBindingId: setup.runtimeBinding._id,
    setupOperationId: setup.setupOperation._id,
    state: "provisioning" as const,
  };
}

export async function createEvidenceLibrarySetup(
  ctx: MutationCtx,
  args: { name: string; slug: string; publicAddress: string },
) {
  const access = await requireOrganizationAccess(ctx, "manage");
  const name = args.name.trim();
  const slug = args.slug.trim();
  const publicAddress = validateTargetBaseUrl(args.publicAddress);
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw createError(
      "VALIDATION_ERROR",
      "Invalid Evidence Library name or slug",
    );
  }
  const existing = await ctx.db
    .query("evidenceLibraries")
    .withIndex("by_organizationId_and_slug", (query) =>
      query.eq("organizationId", access.organization._id).eq("slug", slug),
    )
    .unique();
  if (existing) {
    const setup = await readEvidenceLibrarySetupRecords(ctx, existing);
    if (existing.name !== name || setup.publicAddress !== publicAddress) {
      throw createError(
        "CONFLICT",
        "Evidence Library setup retry does not match the original request",
      );
    }
    return toSetupDraftResult(setup);
  }

  const now = Date.now();
  const libraryId = await ctx.db.insert("evidenceLibraries", {
    organizationId: access.organization._id,
    name,
    slug,
    state: "provisioning",
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {
    libraryId,
    revisionKey: "r1",
    revisionNumber: 1,
    basedOnRevisionId: null,
    rollbackOfRevisionId: null,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
    libraryId,
    baseRevisionId: revisionId,
    editVersion: 0,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  const setupOperation = await queueEvidenceLibraryOperation(ctx, {
    libraryId,
    kind: "setup",
    idempotencyKey: SETUP_OPERATION_IDEMPOTENCY_KEY,
  });
  const runtimeBinding = await createPendingRuntimeBinding(ctx, {
    libraryId,
    publicAddress,
  });
  await ctx.db.patch("evidenceLibraries", libraryId, {
    draftId,
    latestRevisionId: revisionId,
    runtimeBindingId: runtimeBinding.bindingId,
    setupOperationId: setupOperation.operationId,
  });
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library) {
    throw new Error("Created Evidence Library could not be read");
  }
  return toSetupDraftResult(
    await readEvidenceLibrarySetupRecords(ctx, library),
  );
}

export async function saveEvidenceLibraryDraftSection(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    sectionKey: SectionKey;
    payload: unknown;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    args.expectedEditVersion,
  );
  const payloadByteLength = validateSectionPayload(args.payload);
  assertNoCredentialMaterial(args.sectionKey, args.payload);
  const sections = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const existing = sections.find(
    (section) => section.sectionKey === args.sectionKey,
  );
  const totalByteLength =
    sections.reduce((total, section) => total + section.payloadByteLength, 0) -
    (existing?.payloadByteLength ?? 0) +
    payloadByteLength;
  assertDraftPayloadBudget(totalByteLength);

  const now = Date.now();
  const sectionFields = {
    kind: "draft" as const,
    libraryId: args.libraryId,
    draftId: draft._id,
    sectionKey: args.sectionKey,
    payload: args.payload,
    payloadByteLength,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.replace(
      "evidenceLibraryConfigSections",
      existing._id,
      sectionFields,
    );
  } else {
    await ctx.db.insert("evidenceLibraryConfigSections", sectionFields);
  }
  await ctx.db.patch("evidenceLibraryConfigDrafts", draft._id, {
    editVersion,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  return { editVersion, payloadByteLength };
}

export async function finalizeEvidenceLibraryDraft(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    args.expectedEditVersion,
  );
  const latestRevision = await ctx.db
    .query("evidenceLibraryConfigRevisions")
    .withIndex("by_libraryId_and_revisionNumber", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .order("desc")
    .first();
  const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
  const revisionKey = `r${revisionNumber}`;
  const now = Date.now();
  const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {
    libraryId: args.libraryId,
    revisionKey,
    revisionNumber,
    basedOnRevisionId: draft.baseRevisionId,
    rollbackOfRevisionId: null,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftSections = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  for (const section of draftSections) {
    if (section.kind !== "draft") {
      throw new Error("Draft section index returned a revision row");
    }
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "revision",
      libraryId: args.libraryId,
      revisionId,
      sectionKey: section.sectionKey,
      payload: section.payload,
      payloadByteLength: section.payloadByteLength,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: access.clerkUserId,
      createdAt: now,
    });
  }
  await ctx.db.patch("evidenceLibraryConfigDrafts", draft._id, {
    baseRevisionId: revisionId,
    editVersion,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  await ctx.db.patch("evidenceLibraries", args.libraryId, {
    latestRevisionId: revisionId,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  return { editVersion, revisionId, revisionKey, revisionNumber };
}

export const createSetupDraft = mutation({
  args: { name: v.string(), slug: v.string(), publicAddress: v.string() },
  returns: v.object({
    draftId: v.id("evidenceLibraryConfigDrafts"),
    editVersion: v.number(),
    libraryId: v.id("evidenceLibraries"),
    publicAddress: v.string(),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
    setupOperationId: v.id("evidenceLibraryConfigOperations"),
    state: v.literal("provisioning"),
  }),
  handler: createEvidenceLibrarySetup,
});

export const saveDraftSection = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    sectionKey: sectionKeyValidator,
    payload: v.any(),
    expectedEditVersion: v.number(),
  },
  returns: v.object({
    editVersion: v.number(),
    payloadByteLength: v.number(),
  }),
  handler: saveEvidenceLibraryDraftSection,
});

export const finalizeDraft = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    expectedEditVersion: v.number(),
  },
  returns: v.object({
    editVersion: v.number(),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    revisionKey: v.string(),
    revisionNumber: v.number(),
  }),
  handler: finalizeEvidenceLibraryDraft,
});
