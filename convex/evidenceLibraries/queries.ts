import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import {
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";
import {
  configProvenanceValidator,
  evidenceLibraryConfigDraftFields,
  evidenceLibraryConfigRevisionFields,
  evidenceLibraryFields,
  evidenceLibraryOperationFields,
  evidenceLibraryRuntimeBindingVariantFields,
  evidenceLibrarySetupIdentityFields,
  sectionKeyValidator,
} from "./validators";
import { readEvidenceLibrarySetupIdentity } from "./setupNaming";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";

const {
  setupEncryptedDatabasePassword: _encryptedDatabasePasswordValidator,
  ...evidenceLibraryPublicOperationFields
} = evidenceLibraryOperationFields;

export async function readEvidenceLibraries(ctx: QueryCtx) {
  const access = await requireOrganizationAccess(ctx, "read");
  return await ctx.db
    .query("evidenceLibraries")
    .withIndex("by_organizationId", (query) =>
      query.eq("organizationId", access.organization._id),
    )
    .collect();
}

export const listLibraries = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("evidenceLibraries"),
      _creationTime: v.number(),
      ...evidenceLibraryFields,
    }),
  ),
  handler: readEvidenceLibraries,
});

const evidenceLibrarySetupResultValidator = v.object({
  library: v.object({
    _id: v.id("evidenceLibraries"),
    _creationTime: v.number(),
    ...evidenceLibraryFields,
  }),
  draft: v.object({
    _id: v.id("evidenceLibraryConfigDrafts"),
    _creationTime: v.number(),
    ...evidenceLibraryConfigDraftFields,
  }),
  identity: v.object(evidenceLibrarySetupIdentityFields),
  revision: v.object({
    _id: v.id("evidenceLibraryConfigRevisions"),
    _creationTime: v.number(),
    ...evidenceLibraryConfigRevisionFields,
  }),
  setupOperation: v.object({
    _id: v.id("evidenceLibraryConfigOperations"),
    _creationTime: v.number(),
    ...evidenceLibraryPublicOperationFields,
  }),
  runtimeBinding: v.union(
    v.object({
      _id: v.id("evidenceLibraryRuntimeBindings"),
      _creationTime: v.number(),
      ...evidenceLibraryRuntimeBindingVariantFields.pendingUnassigned,
    }),
    v.object({
      _id: v.id("evidenceLibraryRuntimeBindings"),
      _creationTime: v.number(),
      ...evidenceLibraryRuntimeBindingVariantFields.pendingProvisioned,
    }),
    v.object({
      _id: v.id("evidenceLibraryRuntimeBindings"),
      _creationTime: v.number(),
      ...evidenceLibraryRuntimeBindingVariantFields.ready,
    }),
    v.object({
      _id: v.id("evidenceLibraryRuntimeBindings"),
      _creationTime: v.number(),
      ...evidenceLibraryRuntimeBindingVariantFields.failedUnassigned,
    }),
    v.object({
      _id: v.id("evidenceLibraryRuntimeBindings"),
      _creationTime: v.number(),
      ...evidenceLibraryRuntimeBindingVariantFields.failedProvisioned,
    }),
  ),
  publicAddress: v.string(),
});

async function readEvidenceLibrarySetupForLibrary(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
) {
  const setup = await readEvidenceLibrarySetupRecords(ctx, library);
  const {
    setupEncryptedDatabasePassword: _encryptedDatabasePassword,
    ...publicSetupOperation
  } = setup.setupOperation;
  return {
    ...setup,
    setupOperation: publicSetupOperation,
    identity: await readEvidenceLibrarySetupIdentity(ctx, setup),
  };
}

export async function readEvidenceLibrarySetup(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  return await readEvidenceLibrarySetupForLibrary(ctx, access.library);
}

export const getSetupDraft = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: evidenceLibrarySetupResultValidator,
  handler: readEvidenceLibrarySetup,
});

export const getSetupDraftSelection = query({
  args: { libraryId: v.string() },
  returns: v.union(v.null(), evidenceLibrarySetupResultValidator),
  handler: async (ctx, args) => {
    const access = await requireOrganizationAccess(ctx, "manage");
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) return null;

    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.organizationId !== access.organization._id) {
      return null;
    }
    return await readEvidenceLibrarySetupForLibrary(ctx, library);
  },
});

export async function readEvidenceLibraryDraft(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
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
  const sectionRows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const sections = sectionRows.map((section) => {
    if (section.kind !== "draft") {
      throw new Error("Draft section index returned a revision row");
    }
    return {
      contractProvenance: section.contractProvenance,
      payload: section.payload,
      payloadByteLength: section.payloadByteLength,
      sectionKey: section.sectionKey,
      updatedAt: section.updatedAt,
    };
  });
  return { draft, library: access.library, sections };
}

export async function readEvidenceLibraryRevision(
  ctx: QueryCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
  },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const revision = await ctx.db.get(
    "evidenceLibraryConfigRevisions",
    args.revisionId,
  );
  if (!revision || revision.libraryId !== args.libraryId) {
    throw createError("NOT_FOUND", "Evidence Library revision not found");
  }
  const sectionRows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_revisionId_and_sectionKey", (query) =>
      query.eq("revisionId", args.revisionId),
    )
    .collect();
  const sections = sectionRows.map((section) => {
    if (section.kind !== "revision") {
      throw new Error("Revision section index returned a draft row");
    }
    return {
      contractProvenance: section.contractProvenance,
      createdAt: section.createdAt,
      payload: section.payload,
      payloadByteLength: section.payloadByteLength,
      sectionKey: section.sectionKey,
    };
  });
  return { revision, sections };
}

export const getDraft = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    library: v.object({
      _id: v.id("evidenceLibraries"),
      _creationTime: v.number(),
      ...evidenceLibraryFields,
    }),
    draft: v.object({
      _id: v.id("evidenceLibraryConfigDrafts"),
      _creationTime: v.number(),
      libraryId: v.id("evidenceLibraries"),
      baseRevisionId: v.union(v.id("evidenceLibraryConfigRevisions"), v.null()),
      editVersion: v.number(),
      contractProvenance: configProvenanceValidator,
      createdByClerkUserId: v.string(),
      updatedByClerkUserId: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    sections: v.array(
      v.object({
        sectionKey: sectionKeyValidator,
        payload: v.any(),
        payloadByteLength: v.number(),
        contractProvenance: configProvenanceValidator,
        updatedAt: v.number(),
      }),
    ),
  }),
  handler: readEvidenceLibraryDraft,
});

export const getRevision = query({
  args: {
    libraryId: v.id("evidenceLibraries"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
  },
  returns: v.object({
    revision: v.object({
      _id: v.id("evidenceLibraryConfigRevisions"),
      _creationTime: v.number(),
      libraryId: v.id("evidenceLibraries"),
      revisionKey: v.string(),
      revisionNumber: v.number(),
      basedOnRevisionId: v.union(
        v.id("evidenceLibraryConfigRevisions"),
        v.null(),
      ),
      rollbackOfRevisionId: v.union(
        v.id("evidenceLibraryConfigRevisions"),
        v.null(),
      ),
      contractProvenance: configProvenanceValidator,
      createdByClerkUserId: v.string(),
      createdAt: v.number(),
    }),
    sections: v.array(
      v.object({
        sectionKey: sectionKeyValidator,
        payload: v.any(),
        payloadByteLength: v.number(),
        contractProvenance: configProvenanceValidator,
        createdAt: v.number(),
      }),
    ),
  }),
  handler: readEvidenceLibraryRevision,
});
