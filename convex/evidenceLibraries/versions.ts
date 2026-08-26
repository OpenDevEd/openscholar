import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { validateOwnerSections } from "../../lib/evidence-libraries/configuration/owner-rules";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  claimAndScheduleConfigurationDeployment,
  isConfigurationDeploymentOperation,
  requireNoActiveConfigurationDeployment,
} from "./configurationDeployment";
import { nextDraftEditVersion } from "./draftVersion";
import {
  queueConfigurationDeploymentOperation,
  queueRuntimeUpdateOperation,
} from "./operations";
import { isFreshRuntimeRelease } from "./runtimeReleases";
import { sectionKeyValidator, type SectionKey } from "./validators";

const MAX_VERSION_ROWS = 100;

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

async function readRevisionSectionRows(
  ctx: QueryCtx | MutationCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
) {
  const rows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_revisionId_and_sectionKey", (query) =>
      query.eq("revisionId", revisionId),
    )
    .collect();
  return rows.map((row) => {
    if (row.kind !== "revision") {
      throw new Error("Revision section index returned a draft row");
    }
    return row;
  });
}

// Brings a previous version back: a new revision with that version's
// sections, the draft reset to the same sections, then the normal publish.
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
  const sourceRows = await readRevisionSectionRows(ctx, source._id);
  // The old sections must still pass today's rules before they go live.
  const validated = validateOwnerSections(
    sourceRows.map((row) => ({
      sectionKey: row.sectionKey,
      payload: row.payload,
    })),
    { expectedBaseUrl: running.binding.targetBaseUrl, requireComplete: true },
  );
  const issue = validated.issues[0];
  if (issue) {
    throw createError(
      "VALIDATION_ERROR",
      `${issue.pointer}: ${issue.message}`,
      { pointer: issue.pointer },
    );
  }

  const activationEditVersion = draft.editVersion;
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    activationEditVersion,
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
    rollbackOfRevisionId: source._id,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: running.clerkUserId,
    createdAt: now,
  });
  const draftRows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  for (const row of draftRows) await ctx.db.delete(row._id);
  for (const row of sourceRows) {
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "revision",
      libraryId: args.libraryId,
      revisionId,
      sectionKey: row.sectionKey,
      payload: row.payload,
      payloadByteLength: row.payloadByteLength,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: running.clerkUserId,
      createdAt: now,
    });
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId: args.libraryId,
      draftId: draft._id,
      sectionKey: row.sectionKey,
      payload: row.payload,
      payloadByteLength: row.payloadByteLength,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: running.clerkUserId,
      updatedAt: now,
    });
  }
  await ctx.db.patch(draft._id, {
    baseRevisionId: revisionId,
    editVersion,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: running.clerkUserId,
    updatedAt: now,
  });
  await ctx.db.patch(args.libraryId, {
    latestRevisionId: revisionId,
    updatedByClerkUserId: running.clerkUserId,
    updatedAt: now,
  });
  const operation = await queueConfigurationDeploymentOperation(ctx, {
    libraryId: args.libraryId,
    revisionId,
    idempotencyKey: `activate:${activationEditVersion}`,
    activationEditVersion,
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return { ...started, editVersion, revisionKey, revisionNumber };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readSectionFingerprints(
  ctx: QueryCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
  cache: Map<Id<"evidenceLibraryConfigRevisions">, Map<SectionKey, string>>,
) {
  const cached = cache.get(revisionId);
  if (cached) return cached;
  const rows = await readRevisionSectionRows(ctx, revisionId);
  const fingerprints = new Map<SectionKey, string>(
    rows.map((row) => [row.sectionKey, stableJson(row.payload)]),
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
  changedSections: v.array(sectionKeyValidator),
  status: versionStatusValidator,
  kind: versionKindValidator,
  runtimeCommit: v.optional(v.string()),
});

// One row per setup, publish or software update, newest first.
export async function readEvidenceLibraryVersions(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const operations = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .order("desc")
    .take(MAX_VERSION_ROWS);
  const revisions = new Map<
    Id<"evidenceLibraryConfigRevisions">,
    Doc<"evidenceLibraryConfigRevisions"> | null
  >();
  const fingerprints = new Map<
    Id<"evidenceLibraryConfigRevisions">,
    Map<SectionKey, string>
  >();
  const names = new Map<string, string>();
  const rows = [];
  for (const operation of operations) {
    if (
      !operation.revisionId ||
      (operation.kind !== "setup" &&
        !isConfigurationDeploymentOperation(operation))
    ) {
      continue;
    }
    let revision = revisions.get(operation.revisionId);
    if (revision === undefined) {
      revision = await ctx.db.get(operation.revisionId);
      revisions.set(operation.revisionId, revision);
    }
    if (!revision) continue;
    const kind: "runtime" | "config" = operation.runtimeUpdate
      ? "runtime"
      : "config";
    const status: "live" | "previous" | "failed" | "deploying" =
      operation.status === "failed"
        ? "failed"
        : operation.status === "succeeded"
          ? access.library.activeDeploymentOperationId === operation._id
            ? "live"
            : "previous"
          : "deploying";
    let changedSections: SectionKey[] = [];
    if (kind === "config") {
      const current = await readSectionFingerprints(
        ctx,
        revision._id,
        fingerprints,
      );
      const previous = revision.basedOnRevisionId
        ? await readSectionFingerprints(
            ctx,
            revision.basedOnRevisionId,
            fingerprints,
          )
        : new Map<SectionKey, string>();
      const keys = new Set<SectionKey>([...current.keys(), ...previous.keys()]);
      changedSections = [...keys]
        .filter((key) => current.get(key) !== previous.get(key))
        .sort();
    }
    const runtimeCommit =
      operation.runtimeUpdate?.to ?? operation.receipt?.runtimeCommit;
    rows.push({
      operationId: operation._id,
      revisionId: revision._id,
      revisionKey: revision.revisionKey,
      revisionNumber: revision.revisionNumber,
      createdAt: operation.createdAt,
      by: await readRequesterName(ctx, operation.requestedByClerkUserId, names),
      changedSections,
      status,
      kind,
      ...(runtimeCommit === undefined ? {} : { runtimeCommit }),
    });
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

export const listVersions = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(versionRowValidator),
  handler: readEvidenceLibraryVersions,
});
