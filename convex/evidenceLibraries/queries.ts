import {
  internalQuery,
  query,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { type Infer, v } from "convex/values";
import { normalizeEvidenceLibraryName } from "../../lib/evidence-libraries/setup/naming";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { createError } from "../lib/errors";
import { evidenceLibraryTeardownStepValidator } from "./validators";
import {
  hasEvidenceLibrariesSwitchedOn,
  readOrganizationAccess,
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";
import {
  configProvenanceValidator,
  evidenceLibraryConfigDraftFields,
  evidenceLibraryConfigRevisionFields,
  evidenceLibraryFields,
  evidenceLibraryRuntimeBindingVariantFields,
  evidenceLibrarySetupIdentityFields,
  evidenceLibraryPublicOperationFields,
  currentOwnerConfigurationVersionValidator,
  ownerConfigurationVersionValidator,
  sectionKeyValidator,
  toPublicEvidenceLibraryOperation,
} from "./validators";
import {
  readEvidenceLibraryAddressCandidates,
  readEvidenceLibraryByName,
  readEvidenceLibrarySetupIdentity,
} from "./setupNaming";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import {
  loadDraftConfigurationSnapshot,
  loadRevisionConfigurationSnapshot,
} from "./configurationSnapshot";
import { isRetryableConfigurationDeployment } from "./operations";
import { validateSectionPayload } from "./sectionPayload";

type SnapshotSection = {
  sectionKey: Doc<"evidenceLibraryConfigSections">["sectionKey"];
  payload: unknown;
};
type DraftSectionMetadata = Pick<
  Extract<Doc<"evidenceLibraryConfigSections">, { kind: "draft" }>,
  "kind" | "sectionKey" | "contractProvenance" | "updatedAt"
>;
type RevisionSectionMetadata = Pick<
  Extract<Doc<"evidenceLibraryConfigSections">, { kind: "revision" }>,
  "kind" | "sectionKey" | "contractProvenance" | "createdAt"
>;

export function projectDraftConfigurationSections(
  snapshotSections: readonly SnapshotSection[],
  storedRows: readonly DraftSectionMetadata[],
  header: Pick<
    Doc<"evidenceLibraryConfigDrafts">,
    "contractProvenance" | "updatedAt"
  >,
) {
  const storedByKey = new Map(
    storedRows
      .filter((row) => row.kind === "draft")
      .map((row) => [row.sectionKey, row]),
  );
  return snapshotSections.map(({ sectionKey, payload }) => {
    const stored = storedByKey.get(sectionKey);
    return {
      contractProvenance:
        stored?.contractProvenance ?? header.contractProvenance,
      payload,
      payloadByteLength: validateSectionPayload(payload),
      sectionKey,
      updatedAt: stored?.updatedAt ?? header.updatedAt,
    };
  });
}

export function projectRevisionConfigurationSections(
  snapshotSections: readonly SnapshotSection[],
  storedRows: readonly RevisionSectionMetadata[],
  header: Pick<
    Doc<"evidenceLibraryConfigRevisions">,
    "contractProvenance" | "createdAt"
  >,
) {
  const storedByKey = new Map(
    storedRows
      .filter((row) => row.kind === "revision")
      .map((row) => [row.sectionKey, row]),
  );
  return snapshotSections.map(({ sectionKey, payload }) => {
    const stored = storedByKey.get(sectionKey);
    return {
      contractProvenance:
        stored?.contractProvenance ?? header.contractProvenance,
      createdAt: stored?.createdAt ?? header.createdAt,
      payload,
      payloadByteLength: validateSectionPayload(payload),
      sectionKey,
    };
  });
}

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

const SETUP_STAGES = [
  "queued",
  "database",
  "storage",
  "application",
  "deployment",
  "health_check",
  "completed",
] as const;
type SetupStage = (typeof SETUP_STAGES)[number];
const setupStageValidator = v.union(
  ...SETUP_STAGES.map((stage) => v.literal(stage)),
);
function isSetupStage(stage: string): stage is SetupStage {
  return (SETUP_STAGES as readonly string[]).includes(stage);
}

const TEARDOWN_STAGES = [
  "queued",
  "coolify",
  "storage",
  "database",
  "convex",
  "completed",
] as const;
type TeardownStage = (typeof TEARDOWN_STAGES)[number];
const teardownStageValidator = v.union(
  ...TEARDOWN_STAGES.map((stage) => v.literal(stage)),
);
function isTeardownStage(stage: string): stage is TeardownStage {
  return (TEARDOWN_STAGES as readonly string[]).includes(stage);
}

export type LibraryOverviewStatus = Infer<typeof libraryOverviewStatusValidator>;

/** The one status word the pages show for a library, from its row and its setup operation. */
function libraryOverviewStatus(
  library: Doc<"evidenceLibraries">,
  setupOperation: Pick<Doc<"evidenceLibraryConfigOperations">, "status"> | null,
): LibraryOverviewStatus {
  if (library.state === "disabled") return "deleting";
  if (library.state === "active") return "active";
  if (setupOperation?.status === "running") return "setting_up";
  if (setupOperation?.status === "failed") return "setup_failed";
  return "draft";
}

const libraryOverviewValidator = v.object({
  _id: v.id("evidenceLibraries"),
  name: v.string(),
  publicAddress: v.string(),
  status: libraryOverviewStatusValidator,
  /** The setup step that is running or failed, when the status is about setup. */
  setupStage: v.union(setupStageValidator, v.null()),
  /** The teardown stage while the library is being deleted. */
  teardownStage: v.union(teardownStageValidator, v.null()),
  // Present only on a deletion that stopped, which always records which
  // part stopped. Nothing is invented when it is absent.
  teardownFailedStep: v.optional(evidenceLibraryTeardownStepValidator),
  lastActivatedAt: v.union(v.number(), v.null()),
  accentColor: v.union(v.string(), v.null()),
  /** The favicon the owner uploaded; null means the pages show the OpenScholar icon. */
  faviconUrl: v.union(v.string(), v.null()),
});

/** Read the migrated draft payloads used by list and setup pages. */
async function readDraftConfigurationPayloads(
  ctx: QueryCtx,
  draftId: Id<"evidenceLibraryConfigDrafts"> | undefined,
): Promise<Map<string, unknown> | null> {
  if (!draftId) return null;
  const snapshot = await loadDraftConfigurationSnapshot(ctx, draftId, {
    requireComplete: false,
  });
  return new Map(
    snapshot.migration.snapshot.sections.map((section) => [
      section.sectionKey,
      section.payload,
    ]),
  );
}

/** One row per library for the list page: status, address and the facts under the title. */
async function readLibraryOverview(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
) {
  const [runtimeBinding, setupOperation, activeDeployment, draftPayloads] =
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
      library.state === "disabled"
        ? null
        : readDraftConfigurationPayloads(ctx, library.draftId ?? undefined),
    ]);
  const status = libraryOverviewStatus(library, setupOperation);
  let teardownStage: TeardownStage | null = null;
  let teardownFailedStep:
    | Infer<typeof evidenceLibraryTeardownStepValidator>
    | undefined;
  if (status === "deleting") {
    const teardown = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) =>
        query.eq("libraryId", library._id),
      )
      .order("desc")
      .first();
    teardownStage =
      teardown?.kind === "teardown" && isTeardownStage(teardown.stage)
        ? teardown.stage
        : null;
    // A deletion that stopped says which part stopped, in this library's own
    // words. Another service's message is kept in the log, not shown here.
    teardownFailedStep =
      teardown?.kind === "teardown" && teardown.status === "failed"
        ? teardown.teardownFailedStep
        : undefined;
  }
  const identity = draftPayloads?.get("identity") as
    | { assets?: { favicon?: unknown } }
    | undefined;
  const theme = draftPayloads?.get("theme") as
    | { colors?: { accent?: unknown } }
    | undefined;
  const themeColors = theme?.colors;
  const faviconUrl =
    typeof identity?.assets?.favicon === "string" &&
    identity.assets.favicon !== ""
      ? identity.assets.favicon
      : null;
  return {
    _id: library._id,
    name: library.name,
    publicAddress:
      runtimeBinding?.canonicalBaseUrl ?? runtimeBinding?.targetBaseUrl ?? "",
    status,
    setupStage:
      (status === "setting_up" || status === "setup_failed") &&
      setupOperation &&
      isSetupStage(setupOperation.stage)
        ? setupOperation.stage
        : null,
    teardownStage,
    ...(teardownFailedStep ? { teardownFailedStep } : {}),
    lastActivatedAt: activeDeployment?.receipt?.activatedAt ?? null,
    accentColor:
      typeof themeColors?.accent === "string" ? themeColors.accent : null,
    faviconUrl,
  };
}

/**
 * Whether the active organisation may use the Evidence Library owner pages.
 * The sidebar renders on every page and the pages render before anyone picks
 * an organisation, so this never throws: no sign-in, no active organisation,
 * no settled membership, or a role that no longer matches the token all
 * answer "off". It reads through the same helper as the gate itself, so the
 * pages can never show a form the server would refuse.
 */
export const getEvidenceLibrariesAccess = query({
  args: {},
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx) => ({
    enabled: hasEvidenceLibrariesSwitchedOn(await readOrganizationAccess(ctx)),
  }),
});

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
 * What our own database says about a wanted library name: the library that
 * already has the name, or the addresses the name could still take. The
 * address action checks Coolify and the host itself before answering.
 */
export const readAddressCandidates = internalQuery({
  args: { name: v.string() },
  returns: v.union(
    v.object({
      status: v.literal("name-taken"),
      libraryId: v.id("evidenceLibraries"),
    }),
    v.object({
      status: v.literal("candidates"),
      name: v.string(),
      shortName: v.string(),
      candidates: v.array(
        v.object({ publicAddress: v.string(), slug: v.string() }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requireOrganizationAccess(ctx, "manage");
    const named = await readEvidenceLibraryByName(ctx, {
      organizationId: access.organization._id,
      name: normalizeEvidenceLibraryName(args.name),
    });
    if (named) {
      return { status: "name-taken" as const, libraryId: named._id };
    }
    return {
      status: "candidates" as const,
      ...(await readEvidenceLibraryAddressCandidates(ctx, {
        organizationId: access.organization._id,
        name: args.name,
      })),
    };
  },
});

/**
 * The hosts Coolify served when it was last asked, with the time it was
 * asked. The address action decides whether that is recent enough.
 */
export const readServedHostsCache = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ hosts: v.array(v.string()), fetchedAt: v.number() }),
  ),
  handler: async (ctx) => {
    // Internal only, and the same for everybody: the hosts Coolify serves.
    // Address recovery reads it with no signed-in owner behind the request.
    const row = await ctx.db
      .query("evidenceLibraryServedHosts")
      .withIndex("by_source", (query) => query.eq("source", "coolify"))
      .unique();
    return row ? { hosts: row.hosts, fetchedAt: row.fetchedAt } : null;
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
  status: libraryOverviewStatusValidator,
  faviconUrl: v.union(v.string(), v.null()),
});

async function readEvidenceLibrarySetupForLibrary(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
) {
  const setup = await readEvidenceLibrarySetupRecords(ctx, library);
  const [identity, draftPayloads] = await Promise.all([
    readEvidenceLibrarySetupIdentity(ctx, setup),
    readDraftConfigurationPayloads(ctx, setup.draft._id),
  ]);
  const identityPayload = draftPayloads?.get("identity") as
    | { assets?: { favicon?: unknown } }
    | undefined;
  const faviconUrl =
    typeof identityPayload?.assets?.favicon === "string" &&
    identityPayload.assets.favicon !== ""
      ? identityPayload.assets.favicon
      : null;
  return {
    ...setup,
    setupOperation: toPublicEvidenceLibraryOperation(setup.setupOperation),
    identity,
    status: libraryOverviewStatus(setup.library, setup.setupOperation),
    faviconUrl,
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
  const configurationSnapshot = await loadDraftConfigurationSnapshot(
    ctx,
    draft._id,
    { requireComplete: false },
  );
  const sections = projectDraftConfigurationSections(
    configurationSnapshot.migration.snapshot.sections,
    configurationSnapshot.sections.filter((row) => row.kind === "draft"),
    {
      contractProvenance: draft.contractProvenance,
      updatedAt: draft.updatedAt,
    },
  );
  // The newest operation carries the assembly issues the page lists.
  const latestOperation = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .order("desc")
    .first();
  const operation = latestOperation
    ? {
        ...toPublicEvidenceLibraryOperation(latestOperation),
        retryable: await isRetryableConfigurationDeployment(
          ctx,
          latestOperation,
        ),
      }
    : null;
  return {
    draft: {
      ...draft,
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    },
    library: access.library,
    operation,
    sections,
  };
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
  const configurationSnapshot = await loadRevisionConfigurationSnapshot(
    ctx,
    args.revisionId,
    { requireComplete: false },
  );
  const sections = projectRevisionConfigurationSections(
    configurationSnapshot.migration.snapshot.sections,
    configurationSnapshot.sections.filter((row) => row.kind === "revision"),
    {
      contractProvenance: revision.contractProvenance,
      createdAt: revision.createdAt,
    },
  );
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
      ownerConfigurationVersion: currentOwnerConfigurationVersionValidator,
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
        retryable: v.boolean(),
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
      ownerConfigurationVersion: ownerConfigurationVersionValidator,
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

const teamPersonValidator = v.object({
  clerkUserId: v.string(),
  name: v.string(),
  email: v.string(),
});

/**
 * The people who can work on this library: organisation admins own it and
 * change every setting, organisation members edit records in its /admin.
 * Names and emails come from the projected users table; someone whose user
 * row has not arrived yet is listed by Clerk id with an empty name and email.
 */
export const listTeam = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    organizationName: v.string(),
    owners: v.array(teamPersonValidator),
    editors: v.array(teamPersonValidator),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "read");
    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (query) =>
        query.eq("organizationId", access.organization._id).eq("state", "active"),
      )
      .collect();
    const people = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (query) => query.eq("clerkId", membership.clerkUserId))
          .unique();
        return {
          role: membership.role,
          person: {
            clerkUserId: membership.clerkUserId,
            name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
            email: user?.email ?? "",
          },
        };
      }),
    );
    const byName = (left: { person: { name: string; email: string } }, right: { person: { name: string; email: string } }) =>
      (left.person.name || left.person.email).localeCompare(right.person.name || right.person.email);
    people.sort(byName);
    return {
      organizationName: access.organization.name,
      owners: people.filter((entry) => entry.role === "org:admin").map((entry) => entry.person),
      editors: people.filter((entry) => entry.role === "org:member").map((entry) => entry.person),
    };
  },
});
