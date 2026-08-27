import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { type Infer, v } from "convex/values";
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
import {
  findAvailableEvidenceLibrarySetupIdentity,
  readEvidenceLibrarySetupIdentity,
} from "./setupNaming";
import {
  readEvidenceLibraryAdminLaunchTarget,
  readEvidenceLibrarySetupRecords,
} from "./setupRecords";

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

export const libraryOverviewStatusValidator = v.union(
  v.literal("draft"),
  v.literal("setting_up"),
  v.literal("setup_failed"),
  v.literal("active"),
  v.literal("deleting"),
);

const libraryOverviewValidator = v.object({
  _id: v.id("evidenceLibraries"),
  name: v.string(),
  publicAddress: v.string(),
  status: libraryOverviewStatusValidator,
  /** The setup step that is running or failed, when the status is about setup. */
  setupStage: v.union(v.string(), v.null()),
  /** The teardown stage while the library is being deleted. */
  teardownStage: v.union(v.string(), v.null()),
  lastActivatedAt: v.union(v.number(), v.null()),
  accentColor: v.union(v.string(), v.null()),
});

/** One row per library for the list page: status, address and the facts under the title. */
async function readLibraryOverview(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
) {
  const [runtimeBinding, setupOperation, activeDeployment, draftTheme] =
    await Promise.all([
      library.runtimeBindingId
        ? ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId)
        : null,
      library.setupOperationId
        ? ctx.db.get("evidenceLibraryConfigOperations", library.setupOperationId)
        : null,
      library.activeDeploymentOperationId
        ? ctx.db.get(
            "evidenceLibraryConfigOperations",
            library.activeDeploymentOperationId,
          )
        : null,
      library.draftId
        ? ctx.db
            .query("evidenceLibraryConfigSections")
            .withIndex("by_draftId_and_sectionKey", (query) =>
              query.eq("draftId", library.draftId!).eq("sectionKey", "theme"),
            )
            .unique()
        : null,
    ]);
  let status: Infer<typeof libraryOverviewStatusValidator>;
  let teardownStage: string | null = null;
  if (library.state === "disabled") {
    status = "deleting";
    const teardown = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", library._id),
      )
      .order("desc")
      .first();
    teardownStage = teardown?.kind === "teardown" ? teardown.stage : null;
  } else if (library.state === "active") {
    status = "active";
  } else if (setupOperation?.status === "running") {
    status = "setting_up";
  } else if (setupOperation?.status === "failed") {
    status = "setup_failed";
  } else {
    status = "draft";
  }
  const themeColors = (draftTheme?.payload as { colors?: { accent?: unknown } } | undefined)
    ?.colors;
  return {
    _id: library._id,
    name: library.name,
    publicAddress: runtimeBinding?.targetBaseUrl ?? "",
    status,
    setupStage:
      status === "setting_up" || status === "setup_failed"
        ? (setupOperation?.stage ?? null)
        : null,
    teardownStage,
    lastActivatedAt: activeDeployment?.receipt?.activatedAt ?? null,
    accentColor:
      typeof themeColors?.accent === "string" ? themeColors.accent : null,
  };
}

export const listLibraryOverviews = query({
  args: {},
  returns: v.array(libraryOverviewValidator),
  handler: async (ctx) => {
    const libraries = await readEvidenceLibraries(ctx);
    return await Promise.all(
      libraries.map((library) => readLibraryOverview(ctx, library)),
    );
  },
});

/**
 * The short name and platform address a new library would get for this name,
 * so the new-library page can show them before the owner reserves the address.
 */
export const previewSetupIdentity = query({
  args: { name: v.string() },
  returns: v.union(v.null(), v.object(evidenceLibrarySetupIdentityFields)),
  handler: async (ctx, args) => {
    const access = await requireOrganizationAccess(ctx, "manage");
    if (args.name.trim().length === 0) return null;
    return await findAvailableEvidenceLibrarySetupIdentity(ctx, {
      organizationId: access.organization._id,
      name: args.name,
    });
  },
});

export const getAdminLaunchState = query({
  args: { libraryId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      libraryId: v.id("evidenceLibraries"),
      libraryName: v.string(),
      publicAddress: v.string(),
      libraryStatus: libraryOverviewStatusValidator,
      activeRevisionKey: v.union(v.string(), v.null()),
      status: v.union(v.literal("not_ready"), v.literal("ready")),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requireOrganizationAccess(ctx, "read");
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) return null;

    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.organizationId !== access.organization._id) {
      return null;
    }
    const targetBaseUrl = await readEvidenceLibraryAdminLaunchTarget(
      ctx,
      library,
    );
    const [overview, activeRevision] = await Promise.all([
      readLibraryOverview(ctx, library),
      library.activeRevisionId
        ? ctx.db.get("evidenceLibraryConfigRevisions", library.activeRevisionId)
        : null,
    ]);
    return {
      libraryId,
      libraryName: library.name,
      publicAddress: overview.publicAddress,
      libraryStatus: overview.status,
      activeRevisionKey: activeRevision?.revisionKey ?? null,
      status: targetBaseUrl ? ("ready" as const) : ("not_ready" as const),
    };
  },
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
  // The newest operation carries the assembly issues the page lists.
  const latestOperation = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .order("desc")
    .first();
  const operation = latestOperation
    ? (({ setupEncryptedDatabasePassword: _password, ...publicOperation }) =>
        publicOperation)(latestOperation)
    : null;
  return { draft, library: access.library, operation, sections };
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
    operation: v.union(
      v.null(),
      v.object({
        _id: v.id("evidenceLibraryConfigOperations"),
        _creationTime: v.number(),
        ...evidenceLibraryPublicOperationFields,
      }),
    ),
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
