import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { validateOwnerSections } from "../../lib/evidence-libraries/configuration/owner-rules";
import { isPlatformMailConfigured } from "./platformMail";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { claimDomainTransitionRow } from "./domains";
import {
  evidenceLibraryAddressCandidateValidator,
  moveIdentityBaseUrl,
  requireFreeEvidenceLibraryAddress,
} from "./addressRecovery";
import {
  claimAndScheduleConfigurationDeployment,
  isConfigurationDeploymentOperation,
  requireNoActiveConfigurationDeployment,
} from "./configurationDeployment";
import { nextDraftEditVersion } from "./draftVersion";
import {
  queueAddressMoveOperation,
  queueConfigurationDeploymentOperation,
  queueDomainChangeOperation,
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
    .first();
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
  // The live sections must still pass the rules at the new address before
  // anything is written.
  const sourceRows = await readRevisionSectionRows(ctx, running.activeRevisionId);
  const validated = validateOwnerSections(
    sourceRows.map((row) => ({
      sectionKey: row.sectionKey,
      payload:
        row.sectionKey === "identity"
          ? { ...(row.payload as Record<string, unknown>), baseUrl: movedTo }
          : row.payload,
    })),
    {
      expectedBaseUrl: movedTo,
      requireComplete: true,
      platformMailConfigured: isPlatformMailConfigured(),
    },
  );
  const issue = validated.issues[0];
  if (issue) {
    throw createError(
      "VALIDATION_ERROR",
      `${issue.pointer}: ${issue.message}`,
      { pointer: issue.pointer },
    );
  }
  // Nothing is written yet. The records take the new address only once
  // Coolify serves it, so a failed move leaves the library where it is.
  const operation = await queueAddressMoveOperation(ctx, {
    libraryId: args.libraryId,
    idempotencyKey: `address-move:${movedTo}`,
    revisionId: running.activeRevisionId,
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
    {
      expectedBaseUrl:
        running.binding.canonicalBaseUrl ?? running.binding.targetBaseUrl,
      requireComplete: true,
      platformMailConfigured: isPlatformMailConfigured(),
    },
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
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
    const operation = await queueDomainChangeOperation(ctx, {
      libraryId: args.libraryId,
      // One key per change, not per direction: a crash between queuing the
      // deployment and writing its id down reuses this key, while asking for
      // the same change again is a new change with a new key.
      idempotencyKey: `domain:${args.reason}:${args.domainId}:${args.generation}`,
      revisionId: running.activeRevisionId,
      domainChange: {
        host: args.host,
        domainId: args.domainId,
        reason: args.reason,
        token: args.token,
      },
    });
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
    if (args.primary && row.state !== "active") {
      throw createError(
        "CONFLICT",
        "The domain has to be working before it can become the address",
      );
    }
    // The same lease every other change to this domain takes, so becoming
    // the library's address cannot race a check or a removal. It is held
    // until the deployment carrying it settles the row.
    const claimed = claimDomainTransitionRow(ctx, row, "canonical");
    const address = args.primary
      ? `https://${row.host}`
      : running.binding.targetBaseUrl;
    // The live sections must still pass the rules at the new address.
    const sourceRows = await readRevisionSectionRows(
      ctx,
      running.activeRevisionId,
    );
    const validated = validateOwnerSections(
      sourceRows.map((section) => ({
        sectionKey: section.sectionKey,
        payload:
          section.sectionKey === "identity"
            ? { ...(section.payload as Record<string, unknown>), baseUrl: address }
            : section.payload,
      })),
      {
        expectedBaseUrl: address,
        requireComplete: true,
        platformMailConfigured: isPlatformMailConfigured(),
      },
    );
    const issue = validated.issues[0];
    if (issue) {
      throw createError("VALIDATION_ERROR", `${issue.pointer}: ${issue.message}`, {
        pointer: issue.pointer,
      });
    }
    // The lease is taken now, and held until the deployment carrying this
    // change settles the row.
    await claimed.write();
    const operation = await queueDomainChangeOperation(ctx, {
      libraryId: args.libraryId,
      idempotencyKey: `domain:canonical:${args.domainId}:${claimed.generation}`,
      revisionId: running.activeRevisionId,
      domainChange: {
        host: row.host,
        domainId: args.domainId,
        reason: "canonical",
        address,
        token: claimed.token,
      },
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
  {

    const library = await ctx.db.get("evidenceLibraries", args.libraryId);
    const binding = library?.runtimeBindingId
      ? await ctx.db.get(
          "evidenceLibraryRuntimeBindings",
          library.runtimeBindingId,
        )
      : null;
    if (!library || !binding || !library.activeRevisionId) return;
    const primary = args.address !== binding.targetBaseUrl;
    const draft = await ctx.db
      .query("evidenceLibraryConfigDrafts")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .unique();
    const [draftIdentity, revisionIdentity] = await Promise.all([
      draft
        ? ctx.db
            .query("evidenceLibraryConfigSections")
            .withIndex("by_draftId_and_sectionKey", (query) =>
              query.eq("draftId", draft._id).eq("sectionKey", "identity"),
            )
            .unique()
        : null,
      ctx.db
        .query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", (query) =>
          query
            .eq("revisionId", library.activeRevisionId!)
            .eq("sectionKey", "identity"),
        )
        .unique(),
    ]);
    await ctx.db.patch(binding._id, {
      canonicalBaseUrl: primary ? args.address : undefined,
      updatedAt: Date.now(),
    });
    await moveIdentityBaseUrl(ctx, draftIdentity, args.address);
    await moveIdentityBaseUrl(ctx, revisionIdentity, args.address);
    // Only one domain at a time may be the library's address; the others
    // keep sending visitors to it.
    const rows = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
      .collect();
    for (const entry of rows) {
      const role = primary && entry._id === args.domainId ? "primary" : "redirect";
      if (entry.role !== role) {
        await ctx.db.patch(entry._id, { role, updatedAt: Date.now() });
      }
    }
  }
}

export const listVersions = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(versionRowValidator),
  handler: readEvidenceLibraryVersions,
});
