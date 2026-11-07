import { publicName, publicPhoto } from "../../lib/evidence-libraries/configuration/home-people";
import { actingArg, signedInAs } from "../lib/userActions";
import { hasPublicationProviderChanges } from "./publicationProviders";
import { readDomainActivationPlan } from "./domainPlan";
import { readMemberOrganizations, requireCommunityWorkspace } from "../organizationFeatures";
import {
  internalQuery,
  query,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { type Infer, v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { organizationWorkspaceOf } from "../workspaces/personal";
import { normalizeEvidenceLibraryName } from "../../lib/evidence-libraries/setup/naming";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { createError } from "../lib/errors";
import { getCurrentUser, getIdentity } from "../lib/auth";
import { MAX_LIBRARY_MEMBERS, MAX_PENDING_INVITATIONS_PER_LIBRARY } from "../lib/queryBounds";
import { searchTerms } from "../lib/searchText";
import { memberWithEmail } from "../organizations/read";
import {
  draftSectionsValidator,
  evidenceLibraryTeardownStepValidator,
  grantedPeopleValidator,
  revisionSectionsValidator,
  teamInvitationsValidator,
  teamPersonValidator,
} from "./validators";
import {
  grantedRole,
  libraryGrant,
  libraryOf,
  readActiveOrganizationMembership,
  readLibraryRole,
  libraryOwner,
  libraryRoleFrom,
  ownerName,
  requireEvidenceLibraryAccess,
  readEvidenceLibraryAccess,
} from "./access";
import {
  libraryListRoleValidator,
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
  role: libraryListRoleValidator,
  /** Who it belongs to: an organization, or the person whose own workspace it's in. */
  organization: v.object({ name: v.string(), imageUrl: v.union(v.string(), v.null()), kind: v.union(v.literal("person"), v.literal("organization")) }),
  /** Where the list has it from: the person's own workspace, one of their organizations, or shared with them. */
  from: v.union(v.literal("own"), v.literal("organization"), v.literal("shared")),
  workspaceId: v.id("workspaces"),
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

/** Most libraries one page of the list holds, and the rows one read of it passes over looking for matches. */
const LIBRARIES_PAGE_MAX = 50;
const LIBRARY_ROWS_READ = 1_000;
/** Where the granted libraries sit in the list: after every organization the person owns. */
const GRANTED = "granted";

/** The person's own workspace, where their own libraries are (#650), with the name it goes by. */
async function ownWorkspace(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  const workspace = user ? await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", user._id)).unique() : null;
  return user && workspace ? { userId: user._id, workspaceId: workspace._id, shown: await ownerName(ctx, { workspace, organization: null, person: user }) } : null;
}

/** A library a person was granted, with their role and who it belongs to, unless it's in a workspace they own, where it is listed already. */
async function grantedLibrary(ctx: QueryCtx, clerkUserId: string, owned: Set<Id<"workspaces">>, grant: Doc<"itemAccess">) {
  const library = await libraryOf(ctx, grant);
  if (!library?.workspaceId || owned.has(library.workspaceId)) return null;
  const role = await readLibraryRole(ctx, library, clerkUserId);
  const owner = role ? await libraryOwner(ctx, library) : null;
  return role && owner ? { library, role, owner, shown: await ownerName(ctx, owner) } : null;
}

type Shown = { name: string; imageUrl: string | null; kind: "person" | "organization" };
type From = { from: "own" | "organization" | "shared"; workspaceId: Id<"workspaces"> };

/**
 * A library as its list shows it. A viewer's row keeps its name, address and state: how it is being
 * set up, updated or taken down is for the people with a role in it, and so is the look of one
 * that isn't live yet.
 */
const overviewRow = async (ctx: QueryCtx, library: Doc<"evidenceLibraries">, role: Infer<typeof libraryListRoleValidator>, owner: Shown, where: From) => {
  const { teardownFailedStep, ...overview } = await readLibraryOverview(ctx, library);
  if (role !== "viewer") return { ...overview, ...(teardownFailedStep ? { teardownFailedStep } : {}), role, organization: owner, ...where };
  return { ...overview, setupStage: null, teardownStage: null, operation: null, lastActivatedAt: null, ...(overview.status === "active" ? {} : { accentColor: null, faviconUrl: null }), role, organization: owner, ...where };
};

/** The organizations a person is in, each with its workspace and whether they own it, by name, then by ID so two of one name keep their order. */
async function memberOrganizations(ctx: QueryCtx) {
  const rows = (await readMemberOrganizations(ctx)).sort((a, b) => a.organization.name.localeCompare(b.organization.name) || (a.organization._id < b.organization._id ? -1 : 1));
  return await Promise.all(rows.map(async ({ organization, membership }) => ({ ...organization, owns: membership.role === "org:admin", workspaceId: await organizationWorkspaceOf(ctx, organization._id) })));
}

/**
 * The libraries a person can open, a page at a time, filtered on the server (#651, #1090). In an
 * organization's workspace (`organization`), that organization's: its admins own them and its other
 * members view them, with the role they were given in one if any (#653). In their own workspace,
 * everything: their own, then each organization's they're in, one after another by name, then the
 * ones shared with them (on the page of an organization they aren't in, its ones shared with them); `from` narrows it to their own (`own`), one workspace's, or the shared ones.
 * Given `search`, those whose name, or whose owner's name, contains it. The cursor names the source
 * the page stopped in and where.
 */
export const listLibraries = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    organization: v.optional(v.id("organizations")),
    from: v.optional(v.union(v.literal("own"), v.literal("shared"), v.id("workspaces"))),
  },
  returns: paginationResultValidator(libraryOverviewValidator),
  handler: async (ctx, { paginationOpts, search, organization, from }) => {
    const identity = await getIdentity(ctx);
    const person = identity ? await userOf(ctx, identity.subject) : null;
    // A membership or a grant outlives a suspended or deleted account for a while: it lists nothing.
    if (!identity || person?.state !== "active") return { page: [], isDone: true, continueCursor: "" };
    const [members, own] = await Promise.all([memberOrganizations(ctx), ownWorkspace(ctx)]);
    const here = organization ? members.find((entry) => entry._id === organization) : undefined;
    // An organization's page lists its own; the person's own lists every organization they're in.
    const organizations = organization ? (here ? [here] : []) : members;
    // Listed by their workspace, so not again among the ones shared with the person.
    const listedIds = new Set([...members.map((entry) => entry.workspaceId), ...(own ? [own.workspaceId] : [])]);
    const wants = (key: "own" | "shared" | Id<"workspaces">) => !from || from === key;
    const needle = search?.trim().toLowerCase();
    const numItems = Math.min(paginationOpts.numItems, LIBRARIES_PAGE_MAX);
    // What the page has read so far: every source of one page shares one allowance of rows.
    let rows = 0;
    const within = (name: string, ownerName: string) => {
      rows++;
      return !needle || name.toLowerCase().includes(needle) || ownerName.toLowerCase().includes(needle);
    };
    type Read = { page: Infer<typeof libraryOverviewValidator>[]; after: string | null };
    const workspaceSource = (key: string, name: string, workspaceId: Id<"workspaces">, shown: Shown, where: From, roleOf: (library: Doc<"evidenceLibraries">) => Promise<Infer<typeof libraryListRoleValidator>>) => ({
      key,
      name,
      read: async (cursor: string | null, room: number): Promise<Read> => {
        const read = await stream(ctx.db, schema)
          .query("evidenceLibraries")
          .withIndex("by_workspace", (index) => index.eq("workspaceId", workspaceId))
          .filterWith(async (library) => within(library.name, shown.name))
          .paginate({ cursor, numItems: room, maximumRowsRead: Math.max(1, LIBRARY_ROWS_READ - rows) });
        return { page: await Promise.all(read.page.map(async (library) => overviewRow(ctx, library, await roleOf(library), shown, where))), after: read.isDone ? null : read.continueCursor };
      },
    });
    const sources = [
      // Their own workspace's come first, in their own workspace.
      ...(own && !organization && wants("own") ? [workspaceSource(own.workspaceId, "", own.workspaceId, { ...own.shown, kind: "person" }, { from: "own", workspaceId: own.workspaceId }, async () => "owner")] : []),
      ...organizations
        // On an organization's page its own are listed unless the filter asks for what's shared with it.
        .filter((entry) => (organization ? from !== "shared" : wants(entry.workspaceId)))
        .map((entry) => workspaceSource(entry._id, entry.name, entry.workspaceId, { name: entry.name, imageUrl: entry.imageUrl ?? null, kind: "organization" }, { from: "organization", workspaceId: entry.workspaceId }, async (library) =>
          entry.owns ? "owner" : ((await readLibraryRole(ctx, library, identity.subject)) ?? "viewer"))),
      // In their own workspace, the ones shared with them; on the page of an organization they aren't in, its ones shared with them.
      ...(own && (organization ? !here : wants("shared"))
        ? [{
            key: GRANTED,
            name: "",
            read: async (cursor: string | null, room: number): Promise<Read> => {
              // Their roles in libraries are rows of the table every shared item's guests are in (./access.ts).
              const read = await stream(ctx.db, schema)
                .query("itemAccess")
                .withIndex("by_user_and_kind_and_grantedAt", (index) => index.eq("userId", own.userId).eq("kind", "library"))
                .map(async (grant) => grantedLibrary(ctx, identity.subject, listedIds, grant))
                .filterWith(async (granted) => granted !== null && (!organization || granted.owner.organization?._id === organization) && within(granted.library.name, granted.shown.name))
                .paginate({ cursor, numItems: room, maximumRowsRead: Math.max(1, LIBRARY_ROWS_READ - rows) });
              return {
                page: await Promise.all(read.page.map((granted) => overviewRow(ctx, granted!.library, granted!.role, { ...granted!.shown, kind: granted!.owner.organization ? "organization" : "person" }, { from: "shared", workspaceId: granted!.library.workspaceId }))),
                after: read.isDone ? null : read.continueCursor,
              };
            },
          }]
        : []),
    ];
    const stoppedAt = (at: number, after: string | null) => JSON.stringify({ source: sources[at].key, name: sources[at].name, after });
    const startFrom: { source: string; name: string; after: string | null } | null = paginationOpts.cursor ? JSON.parse(paginationOpts.cursor) : null;
    const same = startFrom ? sources.findIndex((source) => source.key === startFrom.source) : 0;
    // The organization the page before stopped in is no longer one the person is in: the list goes on from the next one after it by name.
    const start = same !== -1 ? same : sources.findIndex((source) => source.key === GRANTED || (source.name.localeCompare(startFrom!.name) || (source.key < startFrom!.source ? -1 : 1)) > 0);
    const page: Infer<typeof libraryOverviewValidator>[] = [];
    if (start === -1) return { page, isDone: true, continueCursor: "" };
    for (let at = start; at < sources.length; at++) {
      if (page.length >= numItems) return { page, isDone: false, continueCursor: stoppedAt(at, null) };
      const read = await sources[at].read(at === same ? (startFrom?.after ?? null) : null, numItems - page.length);
      page.push(...read.page);
      if (read.after !== null) return { page, isDone: false, continueCursor: stoppedAt(at, read.after) };
    }
    return { page, isDone: true, continueCursor: "" };
  },
});

/**
 * What our own database says about a wanted library name: the library that
 * already has the name, or the addresses the name could still take. The
 * address action checks Coolify and the host itself before answering.
 */
export const readAddressCandidates = internalQuery({
  args: { ...actingArg,
    workspaceId: v.id("workspaces"), name: v.string() },
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
  handler: async (caller, { actingAs: as, ...args }) => {
    const ctx = await signedInAs(caller, as);
    const { workspaceId } = await requireCommunityWorkspace(ctx, args.workspaceId);
    const named = await readEvidenceLibraryByName(ctx, {
      workspaceId,
      name: normalizeEvidenceLibraryName(args.name),
    });
    if (named) {
      return { status: "name-taken" as const, libraryId: named._id };
    }
    return {
      status: "candidates" as const,
      ...(await readEvidenceLibraryAddressCandidates(ctx, {
        workspaceId,
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
  // Its settings are everyone's who views the library, read-only to all but owners whose plan has Evidence Libraries (#653).
  const access = await readEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "view",
  );
  if (!access) return null;
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Community draft not found");
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
    role: access.role,
    editable: access.role === "owner" && (await readEvidenceLibraryAccess(ctx, args.libraryId, "manage")) !== null,
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
    throw createError("NOT_FOUND", "Evidence Community revision not found");
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
    /** The reader's role in the library, a viewer's for any other member of its organization (#653). */
    role: libraryListRoleValidator,
    /** Whether the reader can change its settings: an owner whose plan has Evidence Libraries. */
    editable: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    return libraryId ? readEvidenceLibraryDraft(ctx, { libraryId }) : null;
  },
});

/** A revision of a library's settings, as its page reads one (`readEvidenceLibraryRevision`). */
export const revisionReadValidator = v.object({
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
  });

export const getRevision = query({
  args: {
    libraryId: v.id("evidenceLibraries"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
  },
  returns: revisionReadValidator,
  handler: readEvidenceLibraryRevision,
});

/** A person as the team page shows them, from their user. */
const personOf = (clerkUserId: string, user: Doc<"users"> | null) => ({ clerkUserId, name: [user?.firstName, user?.lastName].filter(Boolean).join(" "), email: user?.email ?? "", imageUrl: user?.avatarUrl });
const userOf = (ctx: QueryCtx, clerkUserId: string) => ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkUserId)).unique();

/**
 * Everyone with a role on the library, each with it: its organization's owners, read by their
 * role, and the people it grants a role to. The organization's other members aren't read: the
 * team picker searches them a page at a time (`listOrganizationPeople`).
 */
export async function readLibraryPeople(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const owner = await libraryOwner(ctx, library);
  const organization = owner?.organization;
  const person = owner?.workspace.kind === "personal" ? await ctx.db.get("users", owner.workspace.userId) : null;
  const [owners, assignments] = await Promise.all([
    // ponytail: an organization's owners are a handful; past MAX_LIBRARY_MEMBERS the page lists the first.
    organization
      ? ctx.db.query("organizationMemberships")
        .withIndex("by_organizationId_and_state_and_role", q => q.eq("organizationId", organization._id).eq("state", "active").eq("role", "org:admin")).take(MAX_LIBRARY_MEMBERS)
      : [],
    // A library grants at most MAX_LIBRARY_MEMBERS people (./members.ts), each a row of the table every shared item's guests are in.
    ctx.db.query("itemAccess")
      .withIndex("by_item_and_grantedAt", q => q.eq("item", library._id)).take(MAX_LIBRARY_MEMBERS),
  ]);
  const ownerOf = new Map<string, Pick<Doc<"organizationMemberships">, "role">>(owners.map(m => [m.clerkUserId, m]));
  const granted = await Promise.all(assignments.map(async assignment => ({ assignment, user: await ctx.db.get("users", assignment.userId) })));
  const grantOf = new Map(granted.flatMap(({ assignment, user }) => (user ? [[user.clerkId, { assignment, user }] as const] : [])));
  // A library in a person's own workspace is theirs.
  const people = [...new Set([...(person ? [person.clerkId] : []), ...ownerOf.keys(), ...grantOf.keys()])];
  return await Promise.all(people.map(async clerkUserId => {
    // Only an owner's membership changes their role; a grant holder's role is their grant's, in the organization or not.
    const user = grantOf.get(clerkUserId)?.user ?? (await userOf(ctx, clerkUserId));
    return { role: libraryRoleFrom(library, owner, { user, membership: ownerOf.get(clerkUserId) ?? null, assignment: grantOf.get(clerkUserId)?.assignment ?? null }), person: personOf(clerkUserId, user) };
  }));
}

/** Most people one page of the team picker holds. */
const PEOPLE_PAGE_MAX = 50;

/**
 * Members of the library's organization who could be added to its team, a page at a time: by
 * the words of their name or email, or as they joined. Those with a role on the library already
 * are left off their page, which can come back short without being the last.
 */
export const listOrganizationPeople = query({
  args: { libraryId: v.id("evidenceLibraries"), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(teamPersonValidator),
  handler: async (ctx, { libraryId, search, paginationOpts }) => {
    const { library, organization } = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    // A library in a person's own workspace has no organization to add people from.
    if (library.state === "disabled" || !organization) return { page: [], isDone: true, continueCursor: "" };
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PEOPLE_PAGE_MAX) };
    const terms = searchTerms(search);
    const read = await (terms
      ? ctx.db.query("organizationMemberships").withSearchIndex("search_member_text", q => q.search("searchText", terms).eq("organizationId", organization._id).eq("state", "active"))
      : ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", q => q.eq("organizationId", organization._id).eq("state", "active"))
    ).paginate(opts);
    const page = await Promise.all(read.page.map(async membership => {
      if (membership.role === "org:admin") return [];
      const user = await userOf(ctx, membership.clerkUserId);
      // One whose account hasn't reached us yet is offered once it has: a role is given to an account.
      if (!user || user.state === "deleted") return [];
      return (await libraryGrant(ctx, libraryId, user._id)) ? [] : [personOf(membership.clerkUserId, user)];
    }));
    return { ...read, page: page.flat() };
  },
});

/** Whether someone with this email is an active member of the library's organization: they're added from it, not invited. */
export const isOrganizationPerson = query({
  args: { libraryId: v.id("evidenceLibraries"), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { libraryId, email }) => {
    const { organization } = await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    return !!organization && (await memberWithEmail(ctx, organization._id, email));
  },
});

/** A library's team, as its page shows it (`listTeam`). */
export const libraryTeamValidator = v.object({
  organizationName: v.string(),
  owners: grantedPeopleValidator,
  editors: grantedPeopleValidator,
  creators: grantedPeopleValidator,
  invitations: teamInvitationsValidator,
});

/** A library's people by role, which everyone who views it reads; its invitations are for its owners, who manage them (#653). */
export async function readLibraryTeam(ctx: QueryCtx, args: { libraryId: Id<"evidenceLibraries"> }) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "view");
  const people = await readLibraryPeople(ctx, access.library);
  people.sort((a, b) => (a.person.name || a.person.email).localeCompare(b.person.name || b.person.email));
  const owner = access.role === "owner";
  const invitations = owner ? await ctx.db.query("itemInvitations").withIndex("by_item_and_state", q => q.eq("item", args.libraryId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_LIBRARY) : [];
  // Everyone else is told names, photos and roles: an email is the owners', who manage the team.
  const shown = (role: "owner" | "editor" | "creator") => people.filter(p => p.role === role).map(p => (owner ? p.person : { ...p.person, email: "" }));
  return {
    invitations: invitations.map(i => ({ invitationId: i._id, email: i.email, role: grantedRole(i), delivery: i.delivery })),
    organizationName: (await ownerName(ctx, access.owner)).name,
    owners: shown("owner"),
    editors: shown("editor"),
    creators: shown("creator"),
  };
  }

export const listTeam = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: libraryTeamValidator,
  handler: readLibraryTeam,
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
