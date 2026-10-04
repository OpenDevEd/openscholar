import { publicName, publicPhoto } from "../../lib/evidence-libraries/configuration/home-people";
import { hasPublicationProviderChanges } from "./publicationProviders";
import { readDomainActivationPlan } from "./domainPlan";
import { readMemberOrganizations, requireLibraryOrganization } from "../organizationFeatures";
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
import { MAX_LIBRARIES_PER_ORGANIZATION, MAX_LIBRARY_GRANTS_PER_PERSON, MAX_LIBRARY_MEMBERS, MAX_ORGANIZATION_MEMBERS_READ, MAX_PENDING_INVITATIONS_PER_LIBRARY } from "../lib/queryBounds";
import {
  draftSectionsValidator,
  evidenceLibraryTeardownStepValidator,
  revisionSectionsValidator,
} from "./validators";
import {
  readLibraryRole,
  libraryRoleFrom,
  requireEvidenceLibraryAccess,
  readEvidenceLibraryAccess,
} from "./access";
import {
  evidenceLibraryAdminRoleValidator,
  configProvenanceValidator,
  evidenceLibraryConfigDraftFields,
  evidenceLibraryConfigRevisionFields,
  evidenceLibraryFields,
  evidenceLibraryRuntimeBindingVariantFields,
  evidenceLibrarySetupIdentityFields,
  evidenceLibraryPublicOperationFields,
  currentOwnerConfigurationVersionValidator,
  ownerConfigurationVersionValidator,
  toPublicEvidenceLibraryOperation,
} from "./validators";
import {
  readEvidenceLibraryAddressCandidates,
  readEvidenceLibraryByName,
  readEvidenceLibrarySetupIdentity,
} from "./setupNaming";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import {
  configurationSnapshotsEqual,
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
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return [];
  const [memberships, assignments] = await Promise.all([
    readMemberOrganizations(ctx),
    // A person has at most MAX_LIBRARY_GRANTS_PER_PERSON grants (./members.ts).
    ctx.db.query("evidenceLibraryMembers")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .take(MAX_LIBRARY_GRANTS_PER_PERSON),
  ]);
  const owned = await Promise.all(memberships.filter(({membership}) => membership.role === "org:admin").map(({membership}) =>
    // An organization makes at most MAX_LIBRARIES_PER_ORGANIZATION libraries (mutations.ts).
    ctx.db.query("evidenceLibraries").withIndex("by_organizationId", q => q.eq("organizationId", membership.organizationId)).take(MAX_LIBRARIES_PER_ORGANIZATION)));
  const assigned = await Promise.all(assignments.map(m => ctx.db.get("evidenceLibraries", m.libraryId)));
  const candidates = new Map([...owned.flat(), ...assigned].filter((library): library is Doc<"evidenceLibraries"> => library !== null).map(library => [library._id, library]));
  const accessible = await Promise.all([...candidates.values()].map(async library =>
    await readLibraryRole(ctx, library, identity.subject) ? library : null));
  return accessible.filter((library): library is Doc<"evidenceLibraries"> => library !== null);
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
  role: evidenceLibraryAdminRoleValidator,
  organization: v.object({ name: v.string(), imageUrl: v.union(v.string(), v.null()) }),
  name: v.string(),
  publicAddress: v.string(),
  status: libraryOverviewStatusValidator,
  /** The setup step that is running or failed, when the status is about setup. */
  setupStage: v.union(setupStageValidator, v.null()),
  /** The teardown stage while the library is being deleted. */
  teardownStage: v.union(teardownStageValidator, v.null()),
  /** The build currently running for this library, if there is one. */
  operation: v.union(
    v.null(),
    v.object({
      stage: evidenceLibraryPublicOperationFields.stage,
      runtimeUpdate: evidenceLibraryPublicOperationFields.runtimeUpdate,
    }),
  ),
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
  const [
    runtimeBinding,
    setupOperation,
    activeDeployment,
    draftPayloads,
    latestOperation,
  ] =
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
      ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", library._id),
        )
        .order("desc")
        .first(),
    ]);
  const status = libraryOverviewStatus(library, setupOperation);
  let teardownStage: TeardownStage | null = null;
  let teardownFailedStep:
    | Infer<typeof evidenceLibraryTeardownStepValidator>
    | undefined;
  if (status === "deleting") {
    const teardown = latestOperation;
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
  const runningOperation =
    latestOperation &&
    latestOperation.kind !== "teardown" &&
    (latestOperation.kind !== "setup" || latestOperation.revisionId) &&
    (latestOperation.status === "queued" || latestOperation.status === "running")
      ? latestOperation
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
    operation: runningOperation
      ? {
          stage: runningOperation.stage,
          ...(runningOperation.runtimeUpdate
            ? { runtimeUpdate: runningOperation.runtimeUpdate }
            : {}),
        }
      : null,
    ...(teardownFailedStep ? { teardownFailedStep } : {}),
    lastActivatedAt: activeDeployment?.receipt?.activatedAt ?? null,
    accentColor:
      typeof themeColors?.accent === "string" ? themeColors.accent : null,
    faviconUrl,
  };
}

export const listLibraryOverviews = query({
  args: {},
  returns: v.array(libraryOverviewValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const libraries = await readEvidenceLibraries(ctx);
    return await Promise.all(libraries.map(async library => {
      const role = await readLibraryRole(ctx, library, identity.subject);
      const organization = await ctx.db.get("organizations", library.organizationId);
      if (!role || !organization) throw createError("FORBIDDEN", "Library access denied");
      return { ...await readLibraryOverview(ctx, library), role,
        organization: { name: organization.name, imageUrl: organization.imageUrl ?? null } };
    }));
  },
});

/**
 * What our own database says about a wanted library name: the library that
 * already has the name, or the addresses the name could still take. The
 * address action checks Coolify and the host itself before answering.
 */
export const readAddressCandidates = internalQuery({
  args: {
    organizationId: v.id("organizations"), name: v.string() },
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
    const access = await requireLibraryOrganization(ctx, args.organizationId);
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

/** Most hosts one served check asks about: a library's address candidates, or one custom domain. */
const MAX_SERVED_HOSTS_ASKED = 50;

/**
 * Which of `hosts` the current listing holds, and when that listing began, read together in
 * one transaction so a refresh can't swap the listing between the two. Null when Coolify has
 * never been listed. The address action decides whether the listing is recent enough.
 */
export const servedHostsCheck = internalQuery({
  args: { hosts: v.array(v.string()) },
  returns: v.union(v.null(), v.object({ startedAt: v.number(), served: v.array(v.string()) })),
  handler: async (ctx, { hosts }) => {
    // Internal only, and the same for everybody: address recovery reads it with no
    // signed-in owner behind the request.
    const current = await ctx.db
      .query("evidenceLibraryServedHostsListing")
      .withIndex("by_source", (query) => query.eq("source", "coolify"))
      .unique();
    if (!current) return null;
    const asked = hosts.slice(0, MAX_SERVED_HOSTS_ASKED);
    const found = await Promise.all(
      asked.map((host) =>
        ctx.db
          .query("evidenceLibraryServedHostRows")
          .withIndex("by_listing_and_host", (query) => query.eq("listing", current.listing).eq("host", host))
          .first(),
      ),
    );
    return { startedAt: current.startedAt, served: asked.filter((_, i) => found[i] !== null) };
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
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) return null;

    const access = await readEvidenceLibraryAccess(ctx, libraryId, "manage");
    if (!access) return null;
    return await readEvidenceLibrarySetupForLibrary(ctx, access.library);
  },
});

export async function readEvidenceLibraryDraft(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await readEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  if (!access) return null;
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
  const hasUnpublishedChanges = access.library.activeRevisionId
    ? !configurationSnapshotsEqual(
        configurationSnapshot.migration.snapshot,
        (
          await loadRevisionConfigurationSnapshot(
            ctx,
            access.library.activeRevisionId,
            { requireComplete: false },
          )
        ).migration.snapshot,
      )
    : true;
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
  const runtimeBinding = access.library.runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", access.library.runtimeBindingId)
    : null;
  return {
    draft: {
      ...draft,
      ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    },
    liveAddress: runtimeBinding?.canonicalBaseUrl ?? runtimeBinding?.targetBaseUrl ?? null,
    library: access.library,
    operation,
    hasUnpublishedChanges:
      hasUnpublishedChanges ||
      (await hasPublicationProviderChanges(ctx, access.library)) ||
      (await hasDomainChanges(ctx, access.library, draft)),
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
  args: { libraryId: v.string() },
  returns: v.union(v.null(), v.object({
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
      mainDomainId: v.optional(
        v.union(v.id("evidenceLibraryDomains"), v.null()),
      ),
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
    hasUnpublishedChanges: v.boolean(),
    /** Where the library answers now, or null before it first runs. */
    liveAddress: v.union(v.string(), v.null()),
    sections: draftSectionsValidator,
  })),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    return libraryId ? readEvidenceLibraryDraft(ctx, { libraryId }) : null;
  },
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
    sections: revisionSectionsValidator,
  }),
  handler: readEvidenceLibraryRevision,
});

const teamPersonValidator = v.object({
  clerkUserId: v.string(),
  name: v.string(),
  email: v.string(),
  imageUrl: v.optional(v.string()),
});

/**
 * Everyone who is, or could be added to, the library's team: active members of
 * its organization and people with a library grant, each with their role.
 */
async function readLibraryPeople(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const [memberships, assignments] = await Promise.all([
    ctx.db.query("organizationMemberships")
      .withIndex("by_organizationId_and_state", q => q.eq("organizationId", library.organizationId).eq("state", "active")).take(MAX_ORGANIZATION_MEMBERS_READ + 1),
    // A library grants at most MAX_LIBRARY_MEMBERS people (./members.ts).
    ctx.db.query("evidenceLibraryMembers")
      .withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", library._id)).take(MAX_LIBRARY_MEMBERS),
  ]);
  if (memberships.length > MAX_ORGANIZATION_MEMBERS_READ) {
    throw createError("VALIDATION_ERROR", `This organization has more than ${MAX_ORGANIZATION_MEMBERS_READ.toLocaleString("en")} members, more than the team page lists.`);
  }
  const membershipOf = new Map(memberships.map(m => [m.clerkUserId, m]));
  const assignmentOf = new Map(assignments.map(m => [m.clerkUserId, m]));
  const memberIds = new Set(membershipOf.keys());
  const userIds = new Set([...memberIds, ...assignmentOf.keys()]);
  // Roles come from the rows read above, so each person costs one more read: their user.
  const organization = await ctx.db.get("organizations", library.organizationId);
  return await Promise.all([...userIds].map(async clerkUserId => {
    const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkUserId)).unique();
    return {
      role: libraryRoleFrom(library, organization, { user, membership: membershipOf.get(clerkUserId) ?? null, assignment: assignmentOf.get(clerkUserId) ?? null }),
      canAdd: memberIds.has(clerkUserId) && user?.state !== "deleted" && library.state !== "disabled",
      person: { clerkUserId, name: [user?.firstName, user?.lastName].filter(Boolean).join(" "), email: user?.email ?? "", imageUrl: user?.avatarUrl },
    };
  }));
}

/** Owners manage explicit library grants and inherited organization owners. */
export const listTeam = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    organizationName: v.string(),
    owners: v.array(teamPersonValidator),
    editors: v.array(teamPersonValidator),
    creators: v.array(teamPersonValidator),
    availablePeople: v.array(teamPersonValidator),
    invitations: v.array(v.object({ invitationId: v.id("evidenceLibraryInvitations"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")), delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")) })),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const people = await readLibraryPeople(ctx, access.library);
    people.sort((a, b) => (a.person.name || a.person.email).localeCompare(b.person.name || b.person.email));
    return {
      invitations: (await ctx.db.query("evidenceLibraryInvitations").withIndex("by_libraryId_and_state", q => q.eq("libraryId", args.libraryId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_LIBRARY))
        .map(i => ({ invitationId: i._id, email: i.email, role: i.role, delivery: i.delivery })),
      organizationName: access.organization.name,
      owners: people.filter(p => p.role === "owner").map(p => p.person),
      editors: people.filter(p => p.role === "editor").map(p => p.person),
      creators: people.filter(p => p.role === "creator").map(p => p.person),
      availablePeople: people.filter(p => !p.role && p.canAdd).map(p => p.person),
    };
  },
});

/**
 * Everyone with a role on the library, as the published home page names them.
 * A person without a name is left out: an email is private and never a name.
 */
export const readLibraryTeamForAssembly = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(v.object({ id: v.string(), name: v.string(), photo: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const library = await ctx.db.get("evidenceLibraries", args.libraryId);
    if (!library) return [];
    return (await readLibraryPeople(ctx, library)).flatMap(({ role, person }) => {
      const name = publicName(person.name);
      if (!role || !name) return [];
      const photo = publicPhoto(person.imageUrl);
      return [photo ? { id: person.clerkUserId, name, photo } : { id: person.clerkUserId, name }];
    });
  },
});

/** Address choices saved for the next activation count as changes too. */
async function hasDomainChanges(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
  draft: Doc<"evidenceLibraryConfigDrafts">,
): Promise<boolean> {
  if (library.state !== "active" || !library.runtimeBindingId) return false;
  const binding = await ctx.db.get(library.runtimeBindingId);
  if (!binding) return false;
  return (
    await readDomainActivationPlan(ctx, { library, binding, draft })
  ).changed;
}
