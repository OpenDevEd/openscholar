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
  evidenceLibraryCleanupFailureValidator,
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
/** How many times the final step may come round at all, however it fails. */
const MAX_CLEANUP_ROUNDS = 10;

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
  /** Set when the last step ran out of tries. */
  cleanupFailure: v.optional(evidenceLibraryCleanupFailureValidator),
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
  { includeUncertain = false }: { includeUncertain?: boolean } = {},
): Promise<string[]> {
  const rows = await readEvidenceLibraryDomains(ctx, libraryId);
  return rows
    .filter(
      (row) =>
        row.attachedAt !== undefined ||
        // A host the proxy was asked to hold and never confirmed. Taking a
        // library apart has to account for it; a routine comparison must not.
        (includeUncertain && row.attachIntentAt !== undefined),
    )
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
    ...(row.cleanup?.failure ? { cleanupFailure: row.cleanup.failure } : {}),
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
  uncertainHosts: string[];
  domain: {
    domainId: Id<"evidenceLibraryDomains">;
    host: string;
    role: "primary" | "redirect";
    state: "added" | "pointing" | "verified" | "active" | "failed";
    verificationToken: string;
    attached: boolean;
    attachIntent: boolean;
    removing: boolean;
    deploymentPending: boolean;
    generation: number;
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
    uncertainHosts: v.array(v.string()),
    domain: v.union(
      v.object({
        domainId: v.id("evidenceLibraryDomains"),
        host: v.string(),
        role: v.union(v.literal("primary"), v.literal("redirect")),
        state: evidenceLibraryDomainStateValidator,
        verificationToken: v.string(),
        attached: v.boolean(),
        attachIntent: v.boolean(),
        removing: v.boolean(),
        deploymentPending: v.boolean(),
        generation: v.number(),
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
      // Hosts the proxy has confirmed it holds.
      attachedHosts: rows
        .filter((entry) => entry.attachedAt !== undefined)
        .map((entry) => `https://${entry.host}`)
        .sort(),
      // Hosts the proxy was asked to hold and never confirmed. It may or may
      // not have them, so a change has to work either way.
      uncertainHosts: rows
        .filter(
          (entry) =>
            entry.attachedAt === undefined &&
            entry.attachIntentAt !== undefined,
        )
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
            // The proxy was asked to hold this host and never confirmed, so
            // a removal has to take it back out to be sure.
            attachIntent: row.attachIntentAt !== undefined,
            removing: row.removingAt !== undefined,
            // Both halves: the proxy was written, or a deployment carrying
            // that write has not succeeded yet. A failed deployment stays
            // owed, so the next step retries it rather than probing.
            deploymentPending:
              row.deploymentPending === true ||
              row.pendingDeployment !== undefined,
            generation: row.generation,
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
/**
 * Refuses anything to do with a library that is being deleted.
 *
 * A teardown is about to remove the very things a domain change would be
 * writing, so no path — claiming a host, taking or keeping a lease, saving a
 * receipt, removing, or finishing a removal — may carry on past this.
 */
async function requireLibraryNotBeingDeleted(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<void> {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || library.state === "disabled") {
    throw createError("CONFLICT", "That library is being deleted");
  }
}

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
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
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
      // Its first change is its zeroth: every later one counts up from here.
      generation: 0,
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
    v.object({
      status: v.literal("claimed"),
      token: v.string(),
      generation: v.number(),
    }),
    v.object({ status: v.literal("busy"), kind: transitionKindValidator }),
  ),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    const now = Date.now();
    const held = row.transition;
    // A change waiting on a deployment holds the domain for as long as that
    // deployment runs — far longer than an action's own lease — so the clock
    // is not the only thing that can say "busy".
    if (held && (held.expiresAt > now || row.pendingDeployment !== undefined)) {
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
    const generation = row.generation + 1;
    await ctx.db.patch(args.domainId, {
      transition: {
        kind: args.kind,
        token,
        expiresAt: now + DOMAIN_CHECK_LEASE_MS,
      },
      generation,
      updatedAt: now,
    });
    return { status: "claimed" as const, token, generation };
  },
});

/** Keeps a running change's place while it works. */
export const renewDomainTransition = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.transition?.token !== args.token) return null;
    await requireLibraryNotBeingDeleted(ctx, row.libraryId);
    await ctx.db.patch(args.domainId, {
      transition: { ...row.transition, expiresAt: Date.now() + DOMAIN_CHECK_LEASE_MS },
    });
    return null;
  },
});

/**
 * Proves this change still owns the domain, and puts its lease forward.
 *
 * Called immediately before anything outside OpenScholar is written, so a
 * worker that was overtaken — or whose lease ran out while it was slow —
 * stops here instead of writing to the certificate service or the proxy on
 * behalf of a change that is no longer happening.
 */
export const holdDomainTransition = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) {
      throw createError("NOT_FOUND", "That domain is no longer there");
    }
    await requireLibraryNotBeingDeleted(ctx, row.libraryId);
    requireTransition(row, args.token);
    await ctx.db.patch(args.domainId, {
      transition: {
        ...row.transition!,
        expiresAt: Date.now() + DOMAIN_CHECK_LEASE_MS,
      },
      updatedAt: Date.now(),
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

/**
 * Takes the lease from inside another mutation, for a change that is decided
 * and queued in one transaction. Returns the token to record on the
 * operation and the write that takes it.
 */
export async function claimDomainTransitionRow(
  ctx: MutationCtx,
  row: Doc<"evidenceLibraryDomains">,
  kind: "check" | "attach" | "canonical" | "remove",
): Promise<{ token: string; generation: number; write: () => Promise<void> }> {
  const now = Date.now();
  // A library on its way out takes no new work: a teardown is about to
  // delete the very things a new change would be writing.
  const library = await ctx.db.get("evidenceLibraries", row.libraryId);
  if (!library || library.state === "disabled") {
    throw createError("CONFLICT", "That library is being deleted");
  }
  if (
    row.transition &&
    (row.transition.expiresAt > now || row.pendingDeployment !== undefined)
  ) {
    throw createError("CONFLICT", "Another change to that domain is running");
  }
  // A domain on its way out may still be handed back the platform address;
  // that is how an owner stops it being the library's address before it goes.
  if (
    kind !== "remove" &&
    !(kind === "canonical" && row.role === "primary") &&
    row.removingAt !== undefined
  ) {
    throw createError("CONFLICT", "That domain is being removed");
  }
  const token = createTransitionToken();
  const generation = row.generation + 1;
  return {
    token,
    generation,
    write: async () => {
      await ctx.db.patch(row._id, {
        transition: { kind, token, expiresAt: now + DOMAIN_CHECK_LEASE_MS },
        generation,
        updatedAt: now,
      });
    },
  };
}

/** Every write about a domain proves it still holds the lease. */
export function requireTransition(
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
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
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
      // The proxy has answered, so the note that it was asked has done its
      // job. Cleared only here, never before the answer.
      attachIntentAt: undefined,
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

/**
 * The deployment carrying a proxy change finished. Called from the same
 * transaction that marked it succeeded, so the two can never disagree.
 */
export async function settleDomainDeploymentRow(
  ctx: MutationCtx,
  args: {
    domainId: Id<"evidenceLibraryDomains">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    /** The change this deployment carried. It must still hold the domain. */
    token: string;
    /** Whether the deployment succeeded, so the row records what happened. */
    outcome: "succeeded" | "failed";
  },
): Promise<void> {
  const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
  if (!row) return;
  // A deployment only settles the change it was carrying. On success this
  // has to be loud: passing over it would let a stale worker go on and
  // change the library's address on behalf of a change that is over.
  if (row.pendingDeployment?.operationId !== args.operationId) {
    if (args.outcome === "succeeded") {
      throw createError(
        "CONFLICT",
        "Another change took that domain while this one was being applied",
      );
    }
    return;
  }
  if (row.transition?.token !== args.token) {
    // Something else took the domain while this deployment ran. Saying
    // nothing would leave the row claiming a change that never landed.
    throw createError(
      "CONFLICT",
      "Another change took that domain while this one was being applied",
    );
  }
  await ctx.db.patch(args.domainId, {
    // A failed deployment still owes its change, so the record of it stays;
    // only a successful one is settled.
    ...(args.outcome === "succeeded"
      ? { pendingDeployment: undefined, cleanup: undefined }
      : {}),
    // Either way the change is over, so the domain is free again.
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
/**
 * Notes that the proxy is about to be asked to hold this host.
 *
 * Saved before the call, so a crash between the proxy accepting the host and
 * the receipt being written is still visible. The next attempt asks for the
 * same list, which the proxy already has, and writes nothing.
 */
export const writeDomainAttachmentIntent = internalMutation({
  args: { domainId: v.id("evidenceLibraryDomains"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) {
      throw createError("NOT_FOUND", "That domain is no longer there");
    }
    requireTransition(row, args.token);
    await ctx.db.patch(args.domainId, {
      attachIntentAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Takes the domain for the final cleanup and hands back what it needs.
 *
 * A mutation, not a read: the cleanup deletes a certificate, so it has to
 * hold the domain from the moment it decides to act.
 */
export const claimDomainCleanup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    /** The deployment this cleanup belongs to. Proved before it takes hold. */
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.union(
    v.object({
      host: v.string(),
      certificateHostnameId: v.union(v.string(), v.null()),
      token: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    // A domain that has moved on since this was booked must not lose a
    // hostname it now needs. Every one of these is checked before anything
    // outside OpenScholar is touched, not after.
    if (
      !row ||
      row.libraryId !== args.libraryId ||
      row.removingAt === undefined ||
      // Written when the detach completed. A call that cannot point at the
      // same deployment is not this cleanup.
      row.cleanup?.operationId !== args.operationId
    ) {
      return null;
    }
    // Once a teardown owns the library it deletes the hostnames itself.
    const library = await ctx.db.get("evidenceLibraries", row.libraryId);
    if (!library || library.state === "disabled") return null;
    const claimed = await claimDomainTransitionRow(ctx, row, "remove");
    await claimed.write();
    return {
      host: row.host,
      certificateHostnameId: row.certificateHostnameId ?? null,
      token: claimed.token,
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
    /** The cleanup's lease, given back in the same write that books the retry. */
    token: v.optional(v.string()),
    /** True when something outside OpenScholar was actually called. */
    calledProvider: v.boolean(),
    /** Why it failed, in this library's own words rather than a service's. */
    failure: v.optional(evidenceLibraryCleanupFailureValidator),
  },
  returns: v.object({
    status: v.union(
      v.literal("scheduled"),
      v.literal("given-up"),
      v.literal("stale"),
    ),
    attempts: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return { status: "given-up" as const, attempts: 0 };
    const cleanup = row.cleanup;
    // The lease goes back whatever else is decided here, so a cleanup that
    // stopped can never leave the domain held.
    const release =
      args.token && row.transition?.token === args.token
        ? { transition: undefined }
        : {};
    const giveBack = async () => {
      if (Object.keys(release).length > 0) {
        await ctx.db.patch(args.domainId, { ...release, updatedAt: Date.now() });
      }
    };
    // Once a teardown owns the library it deletes the hostnames itself, so
    // this stops rather than racing it.
    const library = await ctx.db.get("evidenceLibraries", row.libraryId);
    if (!library || library.state === "disabled") {
      await giveBack();
      return { status: "stale" as const, attempts: cleanup?.attempts ?? 0 };
    }
    // A call about another deployment says nothing about this one, and a
    // caller holding a lease the row does not have is not this cleanup. The
    // record is written when the detach completes, so a call with no record
    // to point at is not this cleanup either.
    if (
      cleanup === undefined ||
      cleanup.operationId !== args.operationId ||
      (args.token !== undefined && row.transition?.token !== args.token)
    ) {
      await giveBack();
      return { status: "stale" as const, attempts: cleanup?.attempts ?? 0 };
    }
    // A run is already booked, so this call has nothing to add.
    if (cleanup?.scheduledId) {
      const booked = await ctx.db.system.get(cleanup.scheduledId);
      if (booked && booked.state.kind === "pending") {
        await giveBack();
        return { status: "scheduled" as const, attempts: cleanup.attempts };
      }
    }
    // Only a real attempt at the outside service counts. Giving up because
    // this library could not take its own lease would waste every try.
    const attempts = cleanup.attempts + (args.calledProvider ? 1 : 0);
    // Every trip round counts, even the ones that never reached the
    // certificate service, so this can never go round for ever.
    const rounds = cleanup.rounds + 1;
    if (
      attempts >= MAX_DOMAIN_CLEANUP_ATTEMPTS ||
      rounds >= MAX_CLEANUP_ROUNDS
    ) {
      await ctx.db.patch(args.domainId, {
        cleanup: {
          operationId: args.operationId,
          attempts,
          rounds,
          // Saved so the owner can be told, in this library's own words,
          // what stopped the last step.
          failure: args.failure ?? "unknown",
        },
        ...release,
        updatedAt: Date.now(),
      });
      return { status: "given-up" as const, attempts };
    }
    const scheduledId = await ctx.scheduler.runAfter(
      // Never zero: a failure before the certificate service was reached
      // would otherwise come straight back with no wait at all.
      CLEANUP_RETRY_MS * Math.max(attempts, 1),
      internal.evidenceLibraries.domainActions.completeDomainChange,
      {
        libraryId: args.libraryId,
        domainId: args.domainId,
        operationId: args.operationId,
        reason: "detach",
      },
    );
    await ctx.db.patch(args.domainId, {
      cleanup: { operationId: args.operationId, attempts, rounds, scheduledId },
      ...release,
      updatedAt: Date.now(),
    });
    return { status: "scheduled" as const, attempts };
  },
});

/** The last step of a removal: the row goes once nothing else holds the host. */
export const finishDomainRemoval = internalMutation({
  args: {
    domainId: v.id("evidenceLibraryDomains"),
    /** The cleanup that is doing this. Checked again right before the row goes. */
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return null;
    // Deleting the row is the last thing that happens to a domain, so the
    // change doing it has to still hold the domain at that moment.
    requireTransition(row, args.token);
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
    /** Convex's own cursor, which keeps its place among equal check times. */
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        domainId: v.id("evidenceLibraryDomains"),
        libraryId: v.id("evidenceLibraries"),
        host: v.string(),
        checkedAt: v.number(),
        generation: v.number(),
        busy: v.boolean(),
        liveRevisionKey: v.union(v.string(), v.null()),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Convex's cursor keeps its place inside a run of rows that share a
    // check time, which a timestamp alone cannot: fifty rows checked in the
    // same millisecond would otherwise be read for ever or skipped whole.
    const page = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_state_and_checkedAt", (index) =>
        index.eq("state", "active").lte("checkedAt", args.cutoff),
      )
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(Math.max(args.limit, 1), 50),
      });
    const rows = await Promise.all(
      page.page.map(async (row) => {
          const library = await ctx.db.get("evidenceLibraries", row.libraryId);
          // A library being deleted is left out entirely: a teardown is
          // removing the very things a sweep would be writing about.
          if (!library || library.state === "disabled") return null;
          const revision = library.activeRevisionId
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
            generation: row.generation,
            // Something is already changing this domain, so the sweep
            // leaves it alone. A lease whose worker died has expired, and
            // the sweep may look at that domain again.
            busy:
              (row.transition !== undefined &&
                row.transition.expiresAt > Date.now()) ||
              row.pendingDeployment !== undefined ||
              row.removingAt !== undefined,
          liveRevisionKey: revision?.revisionKey ?? null,
        };
      }),
    );
    return {
      rows: rows.filter((row) => row !== null),
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});

/**
 * Writes one sweep result. A domain that is still working has its check time
 * moved forward too, so the sweep moves on to the next page.
 */
export const writeSweptDomain = internalMutation({
  args: {
    domainId: v.id("evidenceLibraryDomains"),
    /** What the sweep read before it looked. Anything else and it says nothing. */
    expectedGeneration: v.number(),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  },
  returns: v.object({ written: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row) return { written: false };
    // A teardown may have started while this sweep was looking.
    const library = await ctx.db.get("evidenceLibraries", row.libraryId);
    if (!library || library.state === "disabled") return { written: false };
    // A sweep speaks about the domain as it was when it looked. If a check,
    // a removal or a change of address has happened since, its answer is
    // out of date and must not overwrite the newer one.
    if (
      row.generation !== args.expectedGeneration ||
      (row.transition !== undefined && row.transition.expiresAt > Date.now()) ||
      row.pendingDeployment !== undefined ||
      row.removingAt !== undefined
    ) {
      return { written: false };
    }
    await ctx.db.patch(args.domainId, {
      state: args.state,
      failure: args.failure,
      certificateState: args.certificateState ?? row.certificateState,
      // The domain has moved on, so a second sweep still holding the old
      // count cannot land its answer on top of this one.
      generation: row.generation + 1,
      checkedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { written: true };
  },
});
