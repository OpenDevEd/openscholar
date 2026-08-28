/**
 * The library's own web addresses. One row per custom domain, claimed
 * platform-wide by host, kept apart from the platform address on the runtime
 * binding so a half-finished domain can never affect a running library.
 *
 * Domain is not a configuration section: it has no place in the runtime
 * schema, so it never becomes a draft row and never takes part in Save or
 * Activate. Its actions apply on their own.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { rateLimit } from "../lib/rateLimit";
import { internal } from "../_generated/api";
import {
  isCustomDomainPlatformReady,
  readCustomDomainTarget,
  verificationRecordName,
  verificationRecordValue,
} from "./domainConfig";
import {
  evidenceLibraryCertificateStateValidator,
  evidenceLibraryDomainFailureValidator,
  evidenceLibraryDomainStateValidator,
} from "./validators";

/** One library may hold a small, fixed number of custom domains. */
export const MAX_EVIDENCE_LIBRARY_DOMAINS = 5;

const VERIFICATION_TOKEN_BYTES = 16;

/**
 * How long one check may hold a domain before another may start. The check
 * renews it as it works, so a slow walk up a domain's parents never loses
 * its place, and an abandoned check expires.
 */
export const DOMAIN_CHECK_LEASE_MS = 120_000;

/** How many times the work after a domain's deployment is retried. */
export const MAX_DOMAIN_CLEANUP_ATTEMPTS = 5;

/** How long to wait before trying a domain's final step again. */
const CLEANUP_RETRY_MS = 30_000;

const domainRowValidator = v.object({
  domainId: v.id("evidenceLibraryDomains"),
  host: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: evidenceLibraryDomainStateValidator,
  failure: v.optional(evidenceLibraryDomainFailureValidator),
  certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  attached: v.boolean(),
  removing: v.boolean(),
  deploymentPending: v.boolean(),
  isApex: v.boolean(),
  checkedAt: v.optional(v.number()),
  recordName: v.string(),
  recordValue: v.string(),
});

export async function readEvidenceLibraryDomains(
  ctx: QueryCtx | MutationCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<Doc<"evidenceLibraryDomains">[]> {
  return await ctx.db
    .query("evidenceLibraryDomains")
    .withIndex("by_libraryId", (index) => index.eq("libraryId", libraryId))
    .collect();
}

/**
 * The custom domains the proxy should be serving for this library: the ones
 * we have handed to it and not yet taken back. Every Coolify call compares
 * the complete map against this list.
 */
export async function readAttachedDomainOrigins(
  ctx: QueryCtx | MutationCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<string[]> {
  const rows = await readEvidenceLibraryDomains(ctx, libraryId);
  return rows
    .filter((row) => row.attachedAt !== undefined)
    .map((row) => `https://${row.host}`)
    .sort();
}

function presentDomain(row: Doc<"evidenceLibraryDomains">) {
  return {
    domainId: row._id,
    host: row.host,
    role: row.role,
    state: row.state,
    ...(row.failure ? { failure: row.failure } : {}),
    ...(row.certificateState ? { certificateState: row.certificateState } : {}),
    attached: row.attachedAt !== undefined,
    removing: row.removingAt !== undefined,
    deploymentPending:
      row.deploymentPending === true || row.pendingDeployment !== undefined,
    isApex: row.isApex === true,
    ...(row.checkedAt === undefined ? {} : { checkedAt: row.checkedAt }),
    recordName: verificationRecordName(row.host),
    recordValue: verificationRecordValue(row.verificationToken),
  };
}

async function readRuntimeBinding(
  ctx: QueryCtx | MutationCtx,
  library: Doc<"evidenceLibraries">,
) {
  const binding = library.runtimeBindingId
    ? await ctx.db.get(
        "evidenceLibraryRuntimeBindings",
        library.runtimeBindingId,
      )
    : null;
  if (!binding || binding.libraryId !== library._id) {
    throw createError("INVALID_DATA", "Evidence Library runtime binding not found");
  }
  return binding;
}

/** Everything the Domain section shows. */
export const listDomains = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    platformReady: v.boolean(),
    platformAddress: v.string(),
    canonicalAddress: v.string(),
    target: v.string(),
    live: v.boolean(),
    domains: v.array(domainRowValidator),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const binding = await readRuntimeBinding(ctx, access.library);
    const rows = await readEvidenceLibraryDomains(ctx, args.libraryId);
    return {
      platformReady: isCustomDomainPlatformReady(),
      platformAddress: binding.targetBaseUrl,
      canonicalAddress: binding.canonicalBaseUrl ?? binding.targetBaseUrl,
      target: readCustomDomainTarget(),
      live: access.library.state === "active" && binding.state === "ready",
      domains: rows
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(presentDomain),
    };
  },
});

/**
 * The whole picture one domain action needs, read in one go: the row, the
 * library's addresses, the hosts the proxy already serves for it, and the
 * revision it is running.
 */
type DomainContext = {
  platformAddress: string;
  canonicalAddress: string;
  applicationUuid: string | null;
  liveRevisionKey: string | null;
  attachedHosts: string[];
  domain: {
    domainId: Id<"evidenceLibraryDomains">;
    host: string;
    role: "primary" | "redirect";
    state: "added" | "pointing" | "verified" | "active" | "failed";
    verificationToken: string;
    attached: boolean;
    removing: boolean;
    deploymentPending: boolean;
    certificateHostnameId: string | null;
  } | null;
};

export const readDomainContext = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.optional(v.id("evidenceLibraryDomains")),
  },
  returns: v.object({
    platformAddress: v.string(),
    canonicalAddress: v.string(),
    applicationUuid: v.union(v.string(), v.null()),
    liveRevisionKey: v.union(v.string(), v.null()),
    attachedHosts: v.array(v.string()),
    domain: v.union(
      v.object({
        domainId: v.id("evidenceLibraryDomains"),
        host: v.string(),
        role: v.union(v.literal("primary"), v.literal("redirect")),
        state: evidenceLibraryDomainStateValidator,
        verificationToken: v.string(),
        attached: v.boolean(),
        removing: v.boolean(),
        deploymentPending: v.boolean(),
        certificateHostnameId: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args): Promise<DomainContext> => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const binding = await readRuntimeBinding(ctx, access.library);
    const rows = await readEvidenceLibraryDomains(ctx, args.libraryId);
    const row = args.domainId
      ? rows.find((entry) => entry._id === args.domainId)
      : undefined;
    if (args.domainId && !row) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    const revision = access.library.activeRevisionId
      ? await ctx.db.get(
          "evidenceLibraryConfigRevisions",
          access.library.activeRevisionId,
        )
      : null;
    return {
      platformAddress: binding.targetBaseUrl,
      canonicalAddress: binding.canonicalBaseUrl ?? binding.targetBaseUrl,
      applicationUuid:
        "targetRuntimeId" in binding ? binding.targetRuntimeId : null,
      liveRevisionKey: revision?.revisionKey ?? null,
      attachedHosts: rows
        .filter((entry) => entry.attachedAt !== undefined)
        .map((entry) => `https://${entry.host}`)
        .sort(),
      domain: row
        ? {
            domainId: row._id,
            host: row.host,
            role: row.role,
            state: row.state,
            verificationToken: row.verificationToken,
            attached: row.attachedAt !== undefined,
            removing: row.removingAt !== undefined,
            deploymentPending: row.deploymentPending === true,
            certificateHostnameId: row.certificateHostnameId ?? null,
          }
        : null,
    };
  },
});

function createVerificationToken(): string {
  const bytes = new Uint8Array(VERIFICATION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Claims the host for this library, in one transaction. The action checked
 * the same things a moment earlier; this re-check is what makes the claim
 * safe when two owners press the button at the same time.
 */
export const claimDomainHost = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    host: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("added"),
      domainId: v.id("evidenceLibraryDomains"),
    }),
    v.object({ status: v.literal("host-taken") }),
    v.object({ status: v.literal("too-many") }),
  ),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const held = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_host", (index) => index.eq("host", args.host))
      .first();
    if (held) return { status: "host-taken" as const };
    const rows = await readEvidenceLibraryDomains(ctx, args.libraryId);
    if (rows.length >= MAX_EVIDENCE_LIBRARY_DOMAINS) {
      return { status: "too-many" as const };
    }
    const now = Date.now();
    // One token per library, so the ownership record stays the same when an
    // owner adds a second domain or retypes the first.
    const verificationToken =
      rows[0]?.verificationToken ?? createVerificationToken();
    const domainId = await ctx.db.insert("evidenceLibraryDomains", {
      libraryId: args.libraryId,
      host: args.host,
      verificationToken,
      role: "redirect",
      state: "added",
      createdByClerkUserId: access.clerkUserId,
      createdAt: now,
      updatedAt: now,
    });
    return { status: "added" as const, domainId };
  },
});

/**
 * Takes the right to check one domain. Refuses when another check holds it,
 * and spends the owner's, the library's and the domain's check budget. The
 * caller releases it in a `finally`, and an abandoned lease expires by itself.
 */
const transitionKindValidator = v.union(
  v.literal("check"),
  v.literal("attach"),
  v.literal("canonical"),
  v.literal("remove"),
);

function createTransitionToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Takes the right to change one domain, whatever the change is. Checking,
 * attaching, becoming the library's address and being removed all share the
 * lease, so a removal can never start under a running check and a slow check
 * can never write after a removal took over.
 */
export const claimDomainTransition = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    kind: transitionKindValidator,
    /** Only a check spends the owner's budget; the rest follow one. */
    spendBudget: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ status: v.literal("claimed"), token: v.string() }),
    v.object({ status: v.literal("busy"), kind: transitionKindValidator }),
  ),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    const now = Date.now();
    const held = row.transition;
    if (held && held.expiresAt > now) {
      return { status: "busy" as const, kind: held.kind };
    }
    if (args.spendBudget) {
      await rateLimit(ctx, {
        name: "domain-check-user",
        key: access.clerkUserId,
        throws: true,
      });
      await rateLimit(ctx, {
        name: "domain-check-library",
        key: args.libraryId,
        throws: true,
      });
      await rateLimit(ctx, {
        name: "domain-check-host",
        key: row.host,
        throws: true,
      });
    }
    const token = createTransitionToken();
    await ctx.db.patch(args.domainId, {
      transition: {
        kind: args.kind,
        token,
        expiresAt: now + DOMAIN_CHECK_LEASE_MS,
      },
      updatedAt: now,
    });
    return { status: "claimed" as const, token };
  },
});

/** Keeps a running change's place while it works. */
export const renewDomainTransition = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.transition?.token !== args.token) return null;
    await ctx.db.patch(args.domainId, {
      transition: { ...row.transition, expiresAt: Date.now() + DOMAIN_CHECK_LEASE_MS },
    });
    return null;
  },
});

export const releaseDomainTransition = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    // Only the holder may release it, so a step that ran late cannot free a
    // lease somebody else now holds.
    if (!row || row.transition?.token !== args.token) return null;
    await ctx.db.patch(args.domainId, {
      transition: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Every write about a domain proves it still holds the lease. */
function requireTransition(
  row: { transition?: { token: string } },
  token: string,
): void {
  if (row.transition?.token !== token) {
    throw createError(
      "CONFLICT",
      "Another change to that domain started first",
    );
  }
}

/**
 * Writes what a check found. Never touches the proxy or the certificate, and
 * is never called for a check that could not run: a transient failure leaves
 * the row exactly as it was.
 */
export const writeDomainCheck = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
    isApex: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    requireTransition(row, args.token);
    const now = Date.now();
    await ctx.db.patch(args.domainId, {
      state: args.state,
      failure: args.failure,
      certificateState: args.certificateState ?? row.certificateState,
      isApex: args.isApex ?? row.isApex,
      checkedAt: now,
      updatedAt: now,
      ...(args.state === "active" && row.activatedAt === undefined
        ? { activatedAt: now }
        : {}),
    });
    return null;
  },
});

/**
 * Records that the proxy and the certificate service now hold the host, or
 * no longer do. Kept apart from the check so a host the proxy serves is
 * never forgotten.
 */
/**
 * Records that the proxy's domain list now holds the host, or no longer
 * does, and that a deployment is owed for that change. Both facts are
 * written in one transaction, so a crash can never leave the platform
 * thinking a change reached the running site when it did not.
 */
export const writeDomainAttachment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
    attached: v.boolean(),
    deploymentPending: v.boolean(),
    certificateHostnameId: v.optional(v.string()),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    // A receipt from a step that has been overtaken is refused, so a check
    // cannot reattach a domain a removal already took out.
    requireTransition(row, args.token);
    // Only whether the proxy holds the host changes here. The certificate's
    // id is kept either way: losing it would leave a hostname in the
    // certificate service that nothing points back to.
    await ctx.db.patch(args.domainId, {
      attachedAt: args.attached ? (row.attachedAt ?? Date.now()) : undefined,
      deploymentPending: args.deploymentPending ? true : undefined,
      certificateHostnameId:
        args.certificateHostnameId ?? row.certificateHostnameId,
      certificateState: args.certificateState ?? row.certificateState,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Records the deployment that will carry the proxy change. The change stays
 * owed until that deployment succeeds, so a failed one is redeployed rather
 * than mistaken for a finished change.
 */
export const writeDomainDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
    operationId: v.id("evidenceLibraryConfigOperations"),
    phase: v.union(v.literal("attach"), v.literal("detach")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) return null;
    requireTransition(row, args.token);
    await ctx.db.patch(args.domainId, {
      pendingDeployment: { operationId: args.operationId, phase: args.phase },
      deploymentPending: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * The deployment carrying a proxy change finished. Called from the same
 * transaction that marked it succeeded, so the two can never disagree.
 */
export async function settleDomainDeploymentRow(
  ctx: MutationCtx,
  args: {
    domainId: Id<"evidenceLibraryDomains">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
): Promise<void> {
  const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
  if (!row || row.pendingDeployment?.operationId !== args.operationId) return;
  await ctx.db.patch(args.domainId, {
    pendingDeployment: undefined,
    cleanupAttempts: undefined,
    // The change is live, so whoever was holding the domain for it is done.
    transition: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * Starts removing a domain. Refused for the domain the library calls its own,
 * before anything outside OpenScholar is touched: taking that one out of the
 * proxy would take the library offline.
 */
export const beginDomainRemoval = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("removing"), attached: v.boolean() }),
    v.object({ status: v.literal("gone") }),
  ),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      return { status: "gone" as const };
    }
    requireTransition(row, args.token);
    if (row.role === "primary") {
      throw createError(
        "CONFLICT",
        "Send the platform address back to itself before removing this domain",
      );
    }
    const attached = row.attachedAt !== undefined;
    await ctx.db.patch(args.domainId, {
      removingAt: row.removingAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return { status: "removing" as const, attached };
  },
});

/**
 * One domain row, read without a caller. Used by the scheduled work that
 * finishes a domain change, which runs after the owner's request has ended.
 */
export const readDomainReceipt = internalQuery({
  args: { domainId: v.id("evidenceLibraryDomains") },
  returns: v.union(
    v.object({
      host: v.string(),
      certificateHostnameId: v.union(v.string(), v.null()),
      removing: v.boolean(),
      attached: v.boolean(),
      deploymentPending: v.boolean(),
      cleanupAttempts: v.number(),
      pendingOperationId: v.union(
        v.id("evidenceLibraryConfigOperations"),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return null;
    return {
      host: row.host,
      certificateHostnameId: row.certificateHostnameId ?? null,
      removing: row.removingAt !== undefined,
      attached: row.attachedAt !== undefined,
      deploymentPending:
        row.deploymentPending === true || row.pendingDeployment !== undefined,
      cleanupAttempts: row.cleanupAttempts ?? 0,
      pendingOperationId: row.pendingDeployment?.operationId ?? null,
    };
  },
});

/**
 * Counts one attempt at the work that follows a domain's deployment and
 * books the next run, in one transaction. Attempts belong to the deployment,
 * so a new one always starts from zero.
 */
export const scheduleDomainCleanupRetry = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.object({
    status: v.union(v.literal("scheduled"), v.literal("given-up")),
    attempts: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return { status: "given-up" as const, attempts: 0 };
    const attempts = (row.cleanupAttempts ?? 0) + 1;
    await ctx.db.patch(args.domainId, {
      cleanupAttempts: attempts,
      updatedAt: Date.now(),
    });
    if (attempts >= MAX_DOMAIN_CLEANUP_ATTEMPTS) {
      return { status: "given-up" as const, attempts };
    }
    await ctx.scheduler.runAfter(
      CLEANUP_RETRY_MS * attempts,
      internal.evidenceLibraries.domainActions.completeDomainChange,
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        operationId: args.operationId,
        reason: "detach",
      },
    );
    return { status: "scheduled" as const, attempts };
  },
});

/** The last step of a removal: the row goes once nothing else holds the host. */
export const finishDomainRemoval = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return null;
    if (
      row.role === "primary" ||
      row.attachedAt !== undefined ||
      row.deploymentPending === true ||
      row.pendingDeployment !== undefined
    ) {
      throw createError("CONFLICT", "That domain is still being served");
    }
    await ctx.db.delete(args.domainId);
    return null;
  },
});


/**
 * The next page of working domains to re-check, oldest check first, so a
 * long list is walked completely rather than the first rows being checked
 * for ever.
 */
export const listWorkingDomains = internalQuery({
  args: {
    limit: v.number(),
    /** Only rows checked at or before this moment, fixed when a sweep starts. */
    cutoff: v.number(),
    /** The last row of the previous page: (checkedAt, _id). */
    afterCheckedAt: v.optional(v.number()),
    afterId: v.optional(v.id("evidenceLibraryDomains")),
  },
  returns: v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      libraryId: v.id("evidenceLibraries"),
      host: v.string(),
      checkedAt: v.number(),
      liveRevisionKey: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 50);
    // A real range over the index, so a run of rows that cannot answer never
    // stops the sweep reaching the ones after them. The cursor is strict:
    // every row this page looks at is past it, and a row that could not be
    // checked keeps its old check time and is reached by the next sweep.
    const page = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_state_and_checkedAt", (index) =>
        args.afterCheckedAt === undefined
          ? index.eq("state", "active").lte("checkedAt", args.cutoff)
          : index
              .eq("state", "active")
              .gt("checkedAt", args.afterCheckedAt)
              .lte("checkedAt", args.cutoff),
      )
      .order("asc")
      .take(limit);
    return await Promise.all(
      page.map(async (row) => {
        const library = await ctx.db.get("evidenceLibraries", row.libraryId);
        const revision = library?.activeRevisionId
          ? await ctx.db.get(
              "evidenceLibraryConfigRevisions",
              library.activeRevisionId,
            )
          : null;
        return {
          domainId: row._id,
          libraryId: row.libraryId,
          host: row.host,
          checkedAt: row.checkedAt ?? 0,
          liveRevisionKey: revision?.revisionKey ?? null,
        };
      }),
    );
  },
});

/**
 * Writes one sweep result. A domain that is still working has its check time
 * moved forward too, so the sweep moves on to the next page.
 */
export const writeSweptDomain = internalMutation({
  args: {
    domainId: v.id("evidenceLibraryDomains"),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return null;
    await ctx.db.patch(args.domainId, {
      state: args.state,
      failure: args.failure,
      certificateState: args.certificateState ?? row.certificateState,
      checkedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
