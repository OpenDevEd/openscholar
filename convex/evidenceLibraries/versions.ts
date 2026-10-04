import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { countOf, libraryVersionsOf } from "../lib/listCounts";
import { isVersionOperation } from "./operationKinds";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { validateOwnerSections } from "../../lib/evidence-libraries/configuration/owner-rules";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
  type OwnerConfigurationSnapshot,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { isPlatformMailConfigured } from "./platformMail";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  claimDomainTransitionRow,
  MAX_EVIDENCE_LIBRARY_DOMAINS,
  requireTransition,
} from "./domains";
import {
  evidenceLibraryAddressCandidateValidator,
  moveIdentityBaseUrl,
  requireFreeEvidenceLibraryAddress,
} from "./addressRecovery";
import {
  claimAndScheduleConfigurationDeployment,
  claimAndScheduleInternalConfigurationDeployment,
  isConfigurationDeploymentOperation,
  requireNoActiveConfigurationDeployment,
} from "./configurationDeployment";
import { nextDraftEditVersion } from "./draftVersion";
import {
  queueAddressMoveOperation,
  queueConfigurationDeploymentOperation,
  queueDomainChangeOperation,
  queueInternalRuntimeRollbackOperation,
  queueRuntimeUpdateOperation,
  reissueConfigurationDeploymentOperation,
} from "./operations";
import { isFreshRuntimeRelease } from "./runtimeReleases";
import { isRuntimeImageReference } from "./runtimeImageRegistry";
import { sectionKeyValidator, type SectionKey } from "./validators";
import {
  configurationSectionFingerprints,
  loadDraftConfigurationSnapshot,
  loadRevisionConfigurationSnapshot,
  persistDraftConfigurationSnapshot,
} from "./configurationSnapshot";
import { validateSectionPayload } from "./sectionPayload";
import { changedSectionsValidator } from "./validators";

const MAX_VERSION_ROWS = 100;

type RunningBinding = Extract<
  Doc<"evidenceLibraryRuntimeBindings">,
  { state: "ready" }
>;

type CandidateOperation = {
  operationId: Id<"evidenceLibraryConfigOperations">;
  revisionId: Id<"evidenceLibraryConfigRevisions">;
  status: "queued" | "running" | "succeeded" | "failed";
};

type CandidateIntent = {
  libraryId: Id<"evidenceLibraries">;
  sourceRevisionId: Id<"evidenceLibraryConfigRevisions">;
  snapshot: OwnerConfigurationSnapshot;
  forceCandidate?: boolean;
  idempotencyKey: string;
  rollbackOfRevisionId?: Id<"evidenceLibraryConfigRevisions">;
  updateIdentityTo?: string;
  activationEditVersion?: number;
  runtimeUpdate?: {
    from: string;
    to: string;
    fromImage: string;
    toImage: string;
  };
  addressMove?: {
    from: string;
    to: string;
    movedAt: number;
    count: number;
    applied: boolean;
  };
  domainChange?: {
    host: string;
    domainId: Id<"evidenceLibraryDomains">;
    reason: "attach" | "detach" | "canonical";
    address?: string;
    redeploy?: true;
    token: string;
  };
};

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

async function findOperationByKey(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
  idempotencyKey: string,
) {
  return await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_idempotencyKey", (query) =>
      query.eq("libraryId", libraryId).eq("idempotencyKey", idempotencyKey),
    )
    .unique();
}

function snapshotWithIdentityAddress(
  snapshot: OwnerConfigurationSnapshot,
  address: string,
): OwnerConfigurationSnapshot {
  let found = false;
  const sections = snapshot.sections.map((section) => {
    if (section.sectionKey !== "identity") return section;
    found = true;
    if (
      section.payload === null ||
      typeof section.payload !== "object" ||
      Array.isArray(section.payload)
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library identity configuration is invalid",
      );
    }
    return {
      sectionKey: section.sectionKey,
      payload: {
        ...(section.payload as Record<string, unknown>),
        baseUrl: address,
      },
    };
  });
  if (!found) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library identity configuration is missing",
    );
  }
  return {
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    sections,
  };
}

function requireValidCurrentSnapshot(
  snapshot: OwnerConfigurationSnapshot,
  expectedBaseUrl: string,
): void {
  const validated = validateOwnerSections(snapshot.sections, {
    expectedBaseUrl,
    requireComplete: true,
    platformMailConfigured: isPlatformMailConfigured(),
  });
  const issue = validated.issues[0];
  if (issue) {
    throw createError(
      "VALIDATION_ERROR",
      `${issue.pointer}: ${issue.message}`,
      { pointer: issue.pointer },
    );
  }
}

async function createCurrentCandidateRevision(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    sourceRevisionId: Id<"evidenceLibraryConfigRevisions">;
    snapshot: OwnerConfigurationSnapshot;
    rollbackOfRevisionId?: Id<"evidenceLibraryConfigRevisions">;
    createdByClerkUserId: string;
  },
) {
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
    basedOnRevisionId: args.sourceRevisionId,
    rollbackOfRevisionId: args.rollbackOfRevisionId ?? null,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: args.createdByClerkUserId,
    createdAt: now,
  });
  for (const section of args.snapshot.sections) {
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "revision",
      libraryId: args.libraryId,
      revisionId,
      sectionKey: section.sectionKey,
      payload: section.payload,
      payloadByteLength: validateSectionPayload(section.payload),
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: args.createdByClerkUserId,
      createdAt: now,
    });
  }
  await ctx.db.patch(args.libraryId, {
    latestRevisionId: revisionId,
    updatedByClerkUserId: args.createdByClerkUserId,
    updatedAt: now,
  });
  return { revisionId, revisionKey, revisionNumber };
}

function assertExistingCandidateOperation(
  operation: Doc<"evidenceLibraryConfigOperations">,
  intent: CandidateIntent,
): void {
  if (
    operation.kind !== "publish" ||
    operation.activationEditVersion !==
      (intent.activationEditVersion ?? undefined) ||
    operation.revisionId === undefined
  ) {
    throw createError(
      "CONFLICT",
      "Operation idempotency key does not match the original command",
    );
  }
  if (
    operation.runtimeUpdate?.from !== intent.runtimeUpdate?.from ||
    operation.runtimeUpdate?.to !== intent.runtimeUpdate?.to
  ) {
    throw createError(
      "CONFLICT",
      "Operation idempotency key does not match the original command",
    );
  }
  if (intent.addressMove) {
    if (
      operation.addressMove?.from !== intent.addressMove.from ||
      operation.addressMove?.to !== intent.addressMove.to ||
      operation.addressMove.count !== intent.addressMove.count
    ) {
      throw createError(
        "CONFLICT",
        "Operation idempotency key does not match the original command",
      );
    }
  } else if (operation.addressMove !== undefined) {
    throw createError(
      "CONFLICT",
      "Operation idempotency key does not match the original command",
    );
  }
  if (intent.domainChange) {
    if (
      operation.domainChange?.domainId !== intent.domainChange.domainId ||
      operation.domainChange.host !== intent.domainChange.host ||
      operation.domainChange.reason !== intent.domainChange.reason ||
      operation.domainChange.address !== intent.domainChange.address ||
      operation.domainChange.token !== intent.domainChange.token
    ) {
      throw createError(
        "CONFLICT",
        "Operation idempotency key does not match the original command",
      );
    }
  } else if (operation.domainChange !== undefined) {
    throw createError(
      "CONFLICT",
      "Operation idempotency key does not match the original command",
    );
  }
}

async function queueCandidateOperation(
  ctx: MutationCtx,
  intent: CandidateIntent,
): Promise<CandidateOperation> {
  // This lookup must happen before candidate creation. A retry therefore
  // reuses the same immutable revision instead of making a second one.
  const existing = await findOperationByKey(
    ctx,
    intent.libraryId,
    intent.idempotencyKey,
  );
  if (existing) {
    assertExistingCandidateOperation(existing, intent);
    await reissueConfigurationDeploymentOperation(ctx, existing);
    return {
      operationId: existing._id,
      revisionId: existing.revisionId!,
      status: existing.status,
    };
  }

  const needsCandidate =
    intent.forceCandidate === true || intent.updateIdentityTo !== undefined;
  const candidate = needsCandidate
    ? await createCurrentCandidateRevision(ctx, {
        libraryId: intent.libraryId,
        sourceRevisionId: intent.sourceRevisionId,
        snapshot: intent.updateIdentityTo
          ? snapshotWithIdentityAddress(
              intent.snapshot,
              intent.updateIdentityTo,
            )
          : intent.snapshot,
        rollbackOfRevisionId: intent.rollbackOfRevisionId,
        createdByClerkUserId: (
          await requireEvidenceLibraryAccess(ctx, intent.libraryId, "manage")
        ).clerkUserId,
      })
    : {
        revisionId: intent.sourceRevisionId,
        revisionKey: "",
        revisionNumber: 0,
      };

  const queued = intent.runtimeUpdate
    ? await queueRuntimeUpdateOperation(ctx, {
        libraryId: intent.libraryId,
        idempotencyKey: intent.idempotencyKey,
        revisionId: candidate.revisionId,
        runtimeUpdate: intent.runtimeUpdate,
      })
    : intent.addressMove
      ? await queueAddressMoveOperation(ctx, {
          libraryId: intent.libraryId,
          idempotencyKey: intent.idempotencyKey,
          revisionId: candidate.revisionId,
          addressMove: intent.addressMove,
        })
      : intent.domainChange
        ? await queueDomainChangeOperation(ctx, {
            libraryId: intent.libraryId,
            idempotencyKey: intent.idempotencyKey,
            revisionId: candidate.revisionId,
            domainChange: intent.domainChange,
          })
        : await queueConfigurationDeploymentOperation(ctx, {
            libraryId: intent.libraryId,
            idempotencyKey: intent.idempotencyKey,
            revisionId: candidate.revisionId,
            activationEditVersion: intent.activationEditVersion!,
          });
  return {
    operationId: queued.operationId,
    revisionId: candidate.revisionId,
    status: queued.status,
  };
}

// Publishes the active revision again at the newest Evidence Library
// software. The owner checks for updates first; the fresh release row is
// the only source of the target commit.
/**
 * Section rows a restore deletes from a draft. The schema allows only the registry's
 * sections, one row each, so a draft has no more than there are sections; twice that leaves
 * room for a doubled row of each, which a restore clears too.
 */
const DRAFT_ROWS_REPLACED = SECTION_REGISTRY.length * 2;
/** Publishes read that moved a library onto its current software; past it the restore is refused, not guessed. */
export const RUNTIME_ARRIVALS_READ = 100;

export async function startEvidenceLibraryRuntimeUpdate(
  ctx: MutationCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const running = await requireRunningLibrary(ctx, args.libraryId);
  const from = running.binding.runtimeCommit;
  const release = await ctx.db
    .query("evidenceLibraryRuntimeReleases")
    .withIndex("by_running", (query) => query.eq("running", from))
    .first();
  if (
    !release ||
    typeof release.latestImage !== "string" ||
    !isFreshRuntimeRelease(release.checkedAt, Date.now())
  ) {
    throw createError("CONFLICT", "Check for updates before updating");
  }
  if (release.latest === from) {
    throw createError(
      "CONFLICT",
      "This library already runs the latest software",
    );
  }
  await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  const source = await loadRevisionConfigurationSnapshot(
    ctx,
    running.activeRevisionId,
    { requireComplete: true },
  );
  requireValidCurrentSnapshot(
    source.migration.snapshot,
    running.binding.canonicalBaseUrl ?? running.binding.targetBaseUrl,
  );
  const operation = await queueCandidateOperation(ctx, {
    libraryId: args.libraryId,
    sourceRevisionId: running.activeRevisionId,
    snapshot: source.migration.snapshot,
    forceCandidate:
      source.header.ownerConfigurationVersion !==
      CURRENT_OWNER_CONFIGURATION_VERSION,
    idempotencyKey: `runtime-update:${running.activeRevisionId}:v${CURRENT_OWNER_CONFIGURATION_VERSION}:${from}:${release.latest}`,
    runtimeUpdate: {
      from,
      to: release.latest,
      fromImage: running.binding.runtimeImage,
      toImage: release.latestImage,
    },
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return { ...started, from, to: release.latest };
}

/**
 * Plans a move of a live library to the next free address. The publish that
 * follows changes Coolify's domain first and only then writes the address to
 * the runtime binding, the draft and the live revision, so a failed move
 * keeps the library on the address it has.
 */
export async function startEvidenceLibraryAddressMove(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    // The address the shared check found free: free in our database, not
    // served by Coolify, and answering nothing on the host itself.
    candidate: { publicAddress: string; slug: string };
  },
) {
  const running = await requireRunningLibrary(ctx, args.libraryId);
  await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const movedFrom = running.binding.targetBaseUrl;
  const movedTo = await requireFreeEvidenceLibraryAddress(ctx, {
    library: running.library,
    candidate: args.candidate,
  });
  const source = await loadRevisionConfigurationSnapshot(
    ctx,
    running.activeRevisionId,
    { requireComplete: true },
  );
  // A custom domain stays the library's public identity. This operation moves
  // only the platform address that continues to serve and redirect it.
  const identityBaseUrl = running.binding.canonicalBaseUrl ?? movedTo;
  const movedSnapshot = snapshotWithIdentityAddress(
    source.migration.snapshot,
    identityBaseUrl,
  );
  requireValidCurrentSnapshot(movedSnapshot, identityBaseUrl);
  // Nothing is written yet. The records take the new address only once
  // Coolify serves it, so a failed move leaves the library where it is.
  const operation = await queueCandidateOperation(ctx, {
    libraryId: args.libraryId,
    sourceRevisionId: running.activeRevisionId,
    snapshot: source.migration.snapshot,
    forceCandidate: true,
    updateIdentityTo: identityBaseUrl,
    idempotencyKey: `address-move:${running.activeRevisionId}:v${CURRENT_OWNER_CONFIGURATION_VERSION}:${movedFrom}:${movedTo}`,
    addressMove: {
      from: movedFrom,
      to: movedTo,
      movedAt: Date.now(),
      count: 1,
      applied: false,
    },
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return { ...started, movedFrom, movedTo };
}

// Brings a previous version back: a current-format candidate carries the
// selected snapshot, while the live revision stays untouched until readiness.
export async function restoreEvidenceLibraryRevision(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
  },
) {
  const running = await requireRunningLibrary(ctx, args.libraryId);
  const source = await ctx.db.get(args.revisionId);
  if (!source || source.libraryId !== args.libraryId) {
    throw createError("NOT_FOUND", "Evidence Library version not found");
  }
  await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const sourceSnapshot = await loadRevisionConfigurationSnapshot(
    ctx,
    source._id,
    {
      requireComplete: true,
    },
  );
  requireValidCurrentSnapshot(
    sourceSnapshot.migration.snapshot,
    running.binding.canonicalBaseUrl ?? running.binding.targetBaseUrl,
  );
  const idempotencyKey =
    `restore:${running.activeRevisionId}:` +
    `${source._id}:v${CURRENT_OWNER_CONFIGURATION_VERSION}`;
  const existing = await findOperationByKey(
    ctx,
    args.libraryId,
    idempotencyKey,
  );
  if (existing) {
    assertExistingCandidateOperation(existing, {
      libraryId: args.libraryId,
      sourceRevisionId: running.activeRevisionId,
      snapshot: sourceSnapshot.migration.snapshot,
      idempotencyKey,
      forceCandidate: true,
      rollbackOfRevisionId: source._id,
      activationEditVersion:
        existing.activationEditVersion ?? draft.editVersion,
    });
    await reissueConfigurationDeploymentOperation(ctx, existing);
    const existingRevision = existing.revisionId
      ? await ctx.db.get(existing.revisionId)
      : null;
    if (!existingRevision) {
      throw createError(
        "INVALID_DATA",
        "Restore candidate revision is missing",
      );
    }
    const started = await claimAndScheduleConfigurationDeployment(ctx, {
      libraryId: args.libraryId,
      operationId: existing._id,
    });
    return {
      ...started,
      editVersion: draft.editVersion,
      revisionKey: existingRevision.revisionKey,
      revisionNumber: existingRevision.revisionNumber,
    };
  }

  const activationEditVersion = draft.editVersion;
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    activationEditVersion,
  );
  const now = Date.now();
  const candidate = await createCurrentCandidateRevision(ctx, {
    libraryId: args.libraryId,
    sourceRevisionId: running.activeRevisionId,
    snapshot: sourceSnapshot.migration.snapshot,
    rollbackOfRevisionId: source._id,
    createdByClerkUserId: running.clerkUserId,
  });
  const draftRows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .take(DRAFT_ROWS_REPLACED + 1);
  // Every prior row must go, or the restored draft would carry a stale section.
  if (draftRows.length > DRAFT_ROWS_REPLACED) {
    throw new Error(`The draft has more than ${DRAFT_ROWS_REPLACED} section rows; it can't be restored over until the extra rows are removed.`);
  }
  for (const row of draftRows) await ctx.db.delete(row._id);
  for (const section of sourceSnapshot.migration.snapshot.sections) {
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId: args.libraryId,
      draftId: draft._id,
      sectionKey: section.sectionKey,
      payload: section.payload,
      payloadByteLength: validateSectionPayload(section.payload),
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: running.clerkUserId,
      updatedAt: now,
    });
  }
  await ctx.db.patch(draft._id, {
    baseRevisionId: candidate.revisionId,
    editVersion,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: running.clerkUserId,
    updatedAt: now,
  });
  await ctx.db.patch(args.libraryId, {
    latestRevisionId: candidate.revisionId,
    updatedByClerkUserId: running.clerkUserId,
    updatedAt: now,
  });
  const operation = await queueConfigurationDeploymentOperation(ctx, {
    libraryId: args.libraryId,
    revisionId: candidate.revisionId,
    idempotencyKey,
    activationEditVersion,
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return {
    ...started,
    editVersion,
    revisionKey: candidate.revisionKey,
    revisionNumber: candidate.revisionNumber,
  };
}

async function readSectionFingerprints(
  ctx: QueryCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
  cache: Map<Id<"evidenceLibraryConfigRevisions">, Map<SectionKey, string>>,
) {
  const cached = cache.get(revisionId);
  if (cached) return cached;
  const loaded = await loadRevisionConfigurationSnapshot(ctx, revisionId, {
    requireComplete: false,
  });
  const fingerprints = configurationSectionFingerprints(
    loaded.migration.snapshot,
  );
  cache.set(revisionId, fingerprints);
  return fingerprints;
}

async function readRequesterName(
  ctx: QueryCtx,
  clerkUserId: string,
  cache: Map<string, string>,
) {
  const cached = cache.get(clerkUserId);
  if (cached) return cached;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (query) => query.eq("clerkId", clerkUserId))
    .unique();
  const fullName = [user?.firstName, user?.lastName]
    .filter((part) => part?.trim())
    .join(" ")
    .trim();
  const name = fullName || user?.email || clerkUserId;
  cache.set(clerkUserId, name);
  return name;
}

const versionStatusValidator = v.union(
  v.literal("live"),
  v.literal("previous"),
  v.literal("failed"),
  v.literal("deploying"),
);

const versionKindValidator = v.union(v.literal("runtime"), v.literal("config"));

export const versionRowValidator = v.object({
  operationId: v.id("evidenceLibraryConfigOperations"),
  revisionId: v.id("evidenceLibraryConfigRevisions"),
  revisionKey: v.string(),
  revisionNumber: v.number(),
  createdAt: v.number(),
  by: v.string(),
  changedSections: changedSectionsValidator,
  status: versionStatusValidator,
  kind: versionKindValidator,
  runtimeCommit: v.optional(v.string()),
});

/** What a read of versions has looked up so far, so each revision, its sections and each person are read once. */
type VersionReads = {
  revisions: Map<Id<"evidenceLibraryConfigRevisions">, Doc<"evidenceLibraryConfigRevisions"> | null>;
  fingerprints: Map<Id<"evidenceLibraryConfigRevisions">, Map<SectionKey, string>>;
  names: Map<string, string>;
};
const versionReads = (): VersionReads => ({ revisions: new Map(), fingerprints: new Map(), names: new Map() });

/** The revision a version operation ran, or null when the operation isn't a version or its revision is gone. */
async function versionRevision(ctx: QueryCtx, operation: Doc<"evidenceLibraryConfigOperations">, reads: VersionReads) {
  if (!operation.revisionId || !isVersionOperation(operation)) return null;
  let revision = reads.revisions.get(operation.revisionId);
  if (revision === undefined) {
    revision = await ctx.db.get(operation.revisionId);
    reads.revisions.set(operation.revisionId, revision);
  }
  return revision;
}

/** One version as the Versions section lists it. */
async function versionRow(
  ctx: QueryCtx,
  library: Doc<"evidenceLibraries">,
  operation: Doc<"evidenceLibraryConfigOperations">,
  revision: Doc<"evidenceLibraryConfigRevisions">,
  reads: VersionReads,
) {
  const kind: "runtime" | "config" = operation.runtimeUpdate ? "runtime" : "config";
  const status: "live" | "previous" | "failed" | "deploying" =
    operation.status === "failed"
      ? "failed"
      : operation.status === "succeeded"
        ? library.activeDeploymentOperationId === operation._id
          ? "live"
          : "previous"
        : "deploying";
  let changedSections: SectionKey[] = [];
  if (kind === "config") {
    const current = await readSectionFingerprints(ctx, revision._id, reads.fingerprints);
    const previous = revision.basedOnRevisionId
      ? await readSectionFingerprints(ctx, revision.basedOnRevisionId, reads.fingerprints)
      : new Map<SectionKey, string>();
    const keys = new Set<SectionKey>([...current.keys(), ...previous.keys()]);
    changedSections = [...keys].filter((key) => current.get(key) !== previous.get(key)).sort();
  }
  const runtimeCommit =
    operation.runtimeUpdate?.to ??
    (operation.receipt && "runtimeCommit" in operation.receipt ? operation.receipt.runtimeCommit : undefined);
  return {
    operationId: operation._id,
    revisionId: revision._id,
    revisionKey: revision.revisionKey,
    revisionNumber: revision.revisionNumber,
    createdAt: operation.createdAt,
    by: await readRequesterName(ctx, operation.requestedByClerkUserId, reads.names),
    changedSections,
    status,
    kind,
    ...(runtimeCommit === undefined ? {} : { runtimeCommit }),
  };
}

/**
 * Most versions one page holds, and the operations one read of it passes over looking for them.
 * ponytail: naming what a version changed reads its revision's sections and its predecessor's,
 * so a page reads up to 20 configurations: about 57 KB each at the largest on shared dev
 * (2026-10-04), 1 MB together. Configurations near the 512 KB a section may hold would not
 * fit; a fingerprint stored with each section would lift that.
 */
const VERSIONS_PAGE_MAX = 10;
const VERSION_ROWS_READ = 500;

/** One row per setup, publish or software update, newest first, a page at a time. */
export const listVersionRows = query({
  args: { libraryId: v.id("evidenceLibraries"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(versionRowValidator),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const reads = versionReads();
    return await stream(ctx.db, schema)
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_createdAt", (query) => query.eq("libraryId", args.libraryId))
      .order("desc")
      .filterWith(async (operation) => (await versionRevision(ctx, operation, reads)) !== null)
      .map(async (operation) => versionRow(ctx, access.library, operation, (await versionRevision(ctx, operation, reads))!, reads))
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, VERSIONS_PAGE_MAX), maximumRowsRead: VERSION_ROWS_READ });
  },
});

/** How many versions a library has, kept as its operations are recorded (lib/listCounts.ts). */
export const countVersions = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return await countOf(ctx, libraryVersionsOf(args.libraryId));
  },
});

// The newest MAX_VERSION_ROWS operations as versions, for `listVersions`.
export async function readEvidenceLibraryVersions(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const operations = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) => query.eq("libraryId", args.libraryId))
    .order("desc")
    .take(MAX_VERSION_ROWS);
  const reads = versionReads();
  const rows = [];
  for (const operation of operations) {
    const revision = await versionRevision(ctx, operation, reads);
    if (revision) rows.push(await versionRow(ctx, access.library, operation, revision, reads));
  }
  return rows;
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

export const startRuntimeRollback = internalMutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
    from: v.string(),
    to: v.string(),
  }),
  handler: async (ctx, args) => {
    const library = await ctx.db.get(args.libraryId);
    const binding = library?.runtimeBindingId
      ? await ctx.db.get(library.runtimeBindingId)
      : null;
    if (
      !library?.activeRevisionId ||
      library.state !== "active" ||
      !binding ||
      binding.libraryId !== args.libraryId ||
      binding.state !== "ready"
    ) {
      throw createError("CONFLICT", "This library is not running yet");
    }
    const previous = binding.previousRuntime;
    if (
      !previous ||
      !/^[a-f0-9]{40}$/u.test(previous.commit) ||
      !isRuntimeImageReference(previous.image)
    ) {
      throw createError(
        "CONFLICT",
        "This library does not have an earlier software release to restore",
      );
    }
    if (
      previous.commit === binding.runtimeCommit &&
      previous.image === binding.runtimeImage
    ) {
      throw createError("CONFLICT", "The earlier software is already live");
    }
    // A publish that also moved the library onto this software did so because
    // the earlier software could not read those settings. Settings restored
    // from before that publish are readable again.
    const arrivals = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_failed_runtime", (query) =>
        query
          .eq("libraryId", args.libraryId)
          .eq("status", "succeeded")
          .eq("runtimeUpdate.to", binding.runtimeCommit)
          .eq("runtimeUpdate.toImage", binding.runtimeImage),
      )
      .take(RUNTIME_ARRIVALS_READ + 1);
    const arrival = arrivals.slice(0, RUNTIME_ARRIVALS_READ).find(
      (operation) =>
        operation.activationEditVersion !== undefined &&
        operation.runtimeUpdate?.from === previous.commit,
    );
    // Calling the settings readable on a partial read could put software back under settings it can't read.
    if (!arrival && arrivals.length > RUNTIME_ARRIVALS_READ) {
      throw createError(
        "CONFLICT",
        `This library has moved onto its current software more than ${RUNTIME_ARRIVALS_READ} times, too many to check its settings against the earlier software`,
      );
    }
    const arrivalRevision = arrival?.revisionId
      ? await ctx.db.get(arrival.revisionId)
      : null;
    const live = await ctx.db.get(library.activeRevisionId);
    const restored = live?.rollbackOfRevisionId
      ? await ctx.db.get(live.rollbackOfRevisionId)
      : null;
    if (
      arrivalRevision &&
      !(restored && restored.revisionNumber < arrivalRevision.revisionNumber)
    ) {
      throw createError(
        "CONFLICT",
        "The live settings need the current software; restore settings from before that publish first",
      );
    }
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
    const operation = await queueInternalRuntimeRollbackOperation(ctx, {
      libraryId: args.libraryId,
      revisionId: library.activeRevisionId,
      idempotencyKey:
        `runtime-rollback:${library.activeRevisionId}:` +
        `${binding.runtimeCommit}:${binding.runtimeImage}:` +
        `${previous.commit}:${previous.image}`,
      runtimeUpdate: {
        from: binding.runtimeCommit,
        fromImage: binding.runtimeImage,
        to: previous.commit,
        toImage: previous.image,
      },
    });
    const started = await claimAndScheduleInternalConfigurationDeployment(ctx, {
      libraryId: args.libraryId,
      operationId: operation.operationId,
    });
    return {
      ...started,
      from: binding.runtimeCommit,
      to: previous.commit,
    };
  },
});

export const restoreRevision = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
    editVersion: v.number(),
    revisionKey: v.string(),
    revisionNumber: v.number(),
  }),
  handler: restoreEvidenceLibraryRevision,
});

export const startAddressMove = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    candidate: evidenceLibraryAddressCandidateValidator,
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
    movedFrom: v.string(),
    movedTo: v.string(),
  }),
  handler: startEvidenceLibraryAddressMove,
});

/**
 * Publishes the live revision again. Coolify writes the proxy rules into the
 * container, so a domain only becomes live through a deployment.
 */
export const startDomainDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    /** The domain's change count, so one key never names two changes. */
    generation: v.number(),
    /** The lease this change holds, checked again when the deployment ends. */
    token: v.string(),
    host: v.string(),
    reason: v.union(
      v.literal("attach"),
      v.literal("detach"),
      v.literal("canonical"),
    ),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    const running = await requireRunningLibrary(ctx, args.libraryId);
    // Checked before anything is queued or written: an action that was
    // overtaken while it worked must not replace a newer handoff.
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId || row.host !== args.host) {
      throw createError("NOT_FOUND", "That domain is no longer there");
    }
    requireTransition(row, args.token);
    if (row.generation !== args.generation) {
      throw createError("CONFLICT", "Another change to that domain is running");
    }
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
    const source = await loadRevisionConfigurationSnapshot(
      ctx,
      running.activeRevisionId,
      { requireComplete: true },
    );
    const address =
      args.reason === "canonical" ? `https://${args.host}` : undefined;
    const operationSnapshot = address
      ? snapshotWithIdentityAddress(source.migration.snapshot, address)
      : source.migration.snapshot;
    requireValidCurrentSnapshot(
      operationSnapshot,
      address ??
        running.binding.canonicalBaseUrl ??
        running.binding.targetBaseUrl,
    );
    const idempotencyKey =
      `domain:${running.activeRevisionId}:v${CURRENT_OWNER_CONFIGURATION_VERSION}:` +
      `${args.domainId}:${args.reason}:${args.generation}:${args.host}:${address ?? ""}`;
    const operation = await queueCandidateOperation(ctx, {
      libraryId: args.libraryId,
      sourceRevisionId: running.activeRevisionId,
      snapshot: source.migration.snapshot,
      forceCandidate:
        source.header.ownerConfigurationVersion !==
        CURRENT_OWNER_CONFIGURATION_VERSION,
      updateIdentityTo: address,
      idempotencyKey,
      domainChange: {
        host: args.host,
        domainId: args.domainId,
        reason: args.reason,
        token: args.token,
        ...(address === undefined ? {} : { address }),
      },
    });
    // Written before the worker is booked, and in the same transaction, so
    // there is never a moment when a deployment is running and the domain
    // does not know which change is holding it.
    await ctx.db.patch(args.domainId, {
      pendingDeployment: {
        operationId: operation.operationId,
        token: args.token,
        phase: args.reason,
      },
      deploymentPending: undefined,
      updatedAt: Date.now(),
    });
    return await claimAndScheduleConfigurationDeployment(ctx, {
      libraryId: args.libraryId,
      operationId: operation.operationId,
    });
  },
});

/** Publishes every newly verified host in one proxy deployment. */
export const startDomainDeploymentBatch = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    changes: v.array(
      v.object({
        domainId: v.id("evidenceLibraryDomains"),
        generation: v.number(),
        token: v.string(),
        host: v.string(),
      }),
    ),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
  }),
  handler: async (ctx, args) => {
    if (
      args.changes.length < 1 ||
      args.changes.length > MAX_EVIDENCE_LIBRARY_DOMAINS
    ) {
      throw createError("VALIDATION_ERROR", "Invalid domain deployment batch");
    }
    const running = await requireRunningLibrary(ctx, args.libraryId);
    const ordered = [...args.changes].sort((left, right) =>
      left.host.localeCompare(right.host),
    );
    for (const change of ordered) {
      const row = await ctx.db.get(change.domainId);
      if (
        !row ||
        row.libraryId !== args.libraryId ||
        row.host !== change.host
      ) {
        throw createError("NOT_FOUND", "That domain is no longer there");
      }
      requireTransition(row, change.token);
      if (row.generation !== change.generation) {
        throw createError(
          "CONFLICT",
          "Another change to that domain is running",
        );
      }
    }
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
    const source = await loadRevisionConfigurationSnapshot(
      ctx,
      running.activeRevisionId,
      { requireComplete: true },
    );
    requireValidCurrentSnapshot(
      source.migration.snapshot,
      running.binding.canonicalBaseUrl ?? running.binding.targetBaseUrl,
    );
    const signature = ordered
      .map(
        ({ domainId, generation, host }) => `${domainId}:${generation}:${host}`,
      )
      .join(",");
    const anchor = ordered[0]!;
    const operation = await queueCandidateOperation(ctx, {
      libraryId: args.libraryId,
      sourceRevisionId: running.activeRevisionId,
      snapshot: source.migration.snapshot,
      forceCandidate:
        source.header.ownerConfigurationVersion !==
        CURRENT_OWNER_CONFIGURATION_VERSION,
      idempotencyKey:
        `domains:${running.activeRevisionId}:` +
        `v${CURRENT_OWNER_CONFIGURATION_VERSION}:${signature}`,
      domainChange: {
        host: anchor.host,
        domainId: anchor.domainId,
        reason: "attach",
        token: anchor.token,
      },
    });
    const now = Date.now();
    for (const change of ordered) {
      await ctx.db.patch(change.domainId, {
        pendingDeployment: {
          operationId: operation.operationId,
          token: change.token,
          phase: "attach",
        },
        deploymentPending: undefined,
        updatedAt: now,
      });
    }
    return await claimAndScheduleConfigurationDeployment(ctx, {
      libraryId: args.libraryId,
      operationId: operation.operationId,
    });
  },
});

/**
 * Sends the platform address to a custom domain, or back to itself.
 *
 * Nothing is written here. The change travels on the operation and is only
 * written down once the deployment carrying it is live, so a failed
 * deployment never leaves OpenScholar claiming an address the site does not
 * answer on.
 *
 * The library's address is also where people sign in, so everyone signed in
 * is signed out by this. The platform address is never released: it keeps
 * redirecting for ever, because DOI landing pages already registered point
 * at it.
 */
export const setDomainPrimary = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    primary: v.boolean(),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
    address: v.string(),
  }),
  handler: async (ctx, args) => {
    const running = await requireRunningLibrary(ctx, args.libraryId);
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    // Switching one on needs a working domain. Switching the current one
    // off must always be possible: a domain that stopped working is exactly
    // when an owner needs the platform address back.
    if (args.primary && row.state !== "active") {
      throw createError(
        "CONFLICT",
        "The domain has to be working before it can become the address",
      );
    }
    if (!args.primary && row.role !== "primary") {
      throw createError("CONFLICT", "That domain is not the library's address");
    }
    // The same lease every other change to this domain takes, so becoming
    // the library's address cannot race a check or a removal. It is held
    // until the deployment carrying it settles the row.
    const claimed = await claimDomainTransitionRow(ctx, row, "canonical");
    const address = args.primary
      ? `https://${row.host}`
      : running.binding.targetBaseUrl;
    const source = await loadRevisionConfigurationSnapshot(
      ctx,
      running.activeRevisionId,
      { requireComplete: true },
    );
    const operationSnapshot = snapshotWithIdentityAddress(
      source.migration.snapshot,
      address,
    );
    requireValidCurrentSnapshot(operationSnapshot, address);
    const idempotencyKey =
      `domain:${running.activeRevisionId}:v${CURRENT_OWNER_CONFIGURATION_VERSION}:` +
      `${args.domainId}:canonical:${claimed.generation}:${row.host}:${address}`;
    // The running site takes a new address through the one it answers on
    // now. Only the platform address is always reachable: a custom domain
    // can have lost its records or its certificate while still counting as
    // working, so leaving one goes through a deployment.
    const leaving = (
      await ctx.db
        .query("evidenceLibraryDomains")
        .withIndex("by_libraryId", (index) =>
          index.eq("libraryId", args.libraryId),
        )
        .take(MAX_EVIDENCE_LIBRARY_DOMAINS)
    ).find((entry) => entry.role === "primary");
    const redeploy = leaving !== undefined;
    // The lease is taken now, and held until the deployment carrying this
    // change settles the row.
    await claimed.write();
    const operation = await queueCandidateOperation(ctx, {
      libraryId: args.libraryId,
      sourceRevisionId: running.activeRevisionId,
      snapshot: source.migration.snapshot,
      forceCandidate:
        source.header.ownerConfigurationVersion !==
        CURRENT_OWNER_CONFIGURATION_VERSION,
      updateIdentityTo: address,
      idempotencyKey,
      domainChange: {
        host: row.host,
        domainId: args.domainId,
        reason: "canonical",
        address,
        ...(redeploy ? { redeploy: true as const } : {}),
        token: claimed.token,
      },
    });
    // An address changed straight away replaces whatever the owner had
    // chosen for the next activation.
    const draft = await ctx.db
      .query("evidenceLibraryConfigDrafts")
      .withIndex("by_libraryId", (index) =>
        index.eq("libraryId", args.libraryId),
      )
      .unique();
    if (draft && draft.mainDomainId !== undefined) {
      await ctx.db.patch(draft._id, { mainDomainId: undefined });
    }
    // The deployment is recorded on the domain before the worker is booked,
    // exactly as attaching and removing do, so the change holds it for as
    // long as the deployment runs rather than for an action's lease.
    await ctx.db.patch(args.domainId, {
      pendingDeployment: {
        operationId: operation.operationId,
        token: claimed.token,
        phase: "canonical",
      },
      deploymentPending: undefined,
      updatedAt: Date.now(),
    });
    const started = await claimAndScheduleConfigurationDeployment(ctx, {
      libraryId: args.libraryId,
      operationId: operation.operationId,
    });
    return { ...started, address };
  },
});

/**
 * Writes down the library's new address, once the deployment carrying it is
 * live. `targetBaseUrl` never moves: the platform address keeps redirecting.
 */
export async function applyEvidenceLibraryCanonicalAddress(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    domainId: Id<"evidenceLibraryDomains">;
    address: string;
  },
): Promise<void> {
  const library = await ctx.db.get("evidenceLibraries", args.libraryId);
  const binding = library?.runtimeBindingId
    ? await ctx.db.get(
        "evidenceLibraryRuntimeBindings",
        library.runtimeBindingId,
      )
    : null;
  if (!library || !binding) return;
  const primary = args.address !== binding.targetBaseUrl;
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  let draftSnapshot = draft
    ? await loadDraftConfigurationSnapshot(ctx, draft._id, {
        requireComplete: false,
      })
    : null;
  if (draftSnapshot) {
    await persistDraftConfigurationSnapshot(ctx, draftSnapshot);
    draftSnapshot = await loadDraftConfigurationSnapshot(ctx, draft!._id, {
      requireComplete: false,
    });
  }
  const draftIdentity = draftSnapshot?.sections.find(
    (section) => section.sectionKey === "identity",
  );
  await ctx.db.patch(binding._id, {
    canonicalBaseUrl: primary ? args.address : undefined,
    updatedAt: Date.now(),
  });
  await moveIdentityBaseUrl(
    ctx,
    draftIdentity ?? null,
    args.address,
    draftSnapshot?.migration.snapshot.sections.find(
      (section) => section.sectionKey === "identity",
    )?.payload,
  );
  // Only one domain at a time may be the library's address; the others
  // keep sending visitors to it.
  const rows = await ctx.db
    .query("evidenceLibraryDomains")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .take(MAX_EVIDENCE_LIBRARY_DOMAINS);
  for (const entry of rows) {
    const role =
      primary && entry._id === args.domainId ? "primary" : "redirect";
    if (entry.role !== role) {
      await ctx.db.patch(entry._id, { role, updatedAt: Date.now() });
    }
  }
}

/** Kept for one release, while the deployed site still calls it; `listVersionRows` and `countVersions` replace it. */
export const listVersions = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(versionRowValidator),
  handler: readEvidenceLibraryVersions,
});
