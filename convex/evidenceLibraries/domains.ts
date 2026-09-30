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
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { rateLimit } from "../lib/rateLimit";
import { internal } from "../_generated/api";
import { customDomainDnsRecords } from "./domainConfig";
import { readDomainActivationPlan } from "./domainPlan";
import { isConfigurationDeploymentOperation } from "./operations";
import {
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

const domainRowValidator = v.object({
  domainId: v.id("evidenceLibraryDomains"),
  host: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: evidenceLibraryDomainStateValidator,
  failure: v.optional(evidenceLibraryDomainFailureValidator),
  attached: v.boolean(),
  removing: v.boolean(),
  deploymentPending: v.boolean(),
  isApex: v.boolean(),
  checkedAt: v.optional(v.number()),
  suggestedWwwHost: v.optional(v.string()),
  /** The main address the owner chose, applied by the next activation. */
  main: v.boolean(),
  /** Removed by the owner; goes once the next activation is live. */
  removeOnActivate: v.boolean(),
  records: v.array(
    v.object({
      type: v.union(v.literal("A"), v.literal("CNAME"), v.literal("TXT")),
      label: v.string(),
      name: v.string(),
      value: v.string(),
    }),
  ),
});

const domainContextRowValidator = v.object({
  domainId: v.id("evidenceLibraryDomains"),
  host: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: evidenceLibraryDomainStateValidator,
  verificationToken: v.string(),
  verificationHost: v.string(),
  isApex: v.boolean(),
  attached: v.boolean(),
  attachIntent: v.boolean(),
  removing: v.boolean(),
  deploymentPending: v.boolean(),
  recoverableDeployment: v.boolean(),
  generation: v.number(),
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
 * The platform's own work on a library — finishing a removal the owner asked
 * for once their activation is live — runs with no signed-in owner. Only
 * internal functions accept `platform`, so no browser can ask for it.
 */
async function requireDomainLibraryAccess(
  ctx: QueryCtx | MutationCtx,
  libraryId: Id<"evidenceLibraries">,
  platform: true | undefined,
): Promise<{ library: Doc<"evidenceLibraries">; clerkUserId: string }> {
  if (!platform) {
    return await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
  }
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library) {
    throw createError("NOT_FOUND", "Evidence Library not found");
  }
  return { library, clerkUserId: "platform" };
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

function presentDomain(
  row: Doc<"evidenceLibraryDomains">,
  existingHosts: ReadonlySet<string>,
  includeVerificationRecord: boolean,
  mainAddress: string,
) {
  const isApex = row.isApex === true;
  const suggestedWwwHost = `www.${row.host}`;
  return {
    domainId: row._id,
    host: row.host,
    role: row.role,
    state: row.state,
    ...(row.failure ? { failure: row.failure } : {}),
    attached: row.attachedAt !== undefined,
    removing: row.removingAt !== undefined,
    deploymentPending:
      row.deploymentPending === true || row.pendingDeployment !== undefined,
    isApex,
    ...(row.checkedAt === undefined ? {} : { checkedAt: row.checkedAt }),
    ...(isApex && !existingHosts.has(suggestedWwwHost)
      ? { suggestedWwwHost }
      : {}),
    main: mainAddress === `https://${row.host}`,
    removeOnActivate: row.removeOnActivateAt !== undefined,
    records: customDomainDnsRecords({
      host: row.host,
      isApex,
      verificationHost: row.verificationHost,
      includeVerificationRecord,
      token: row.verificationToken,
    }),
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
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding not found",
    );
  }
  return binding;
}

/** Everything the Domain section shows. */
export const listDomains = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    platformAddress: v.string(),
    canonicalAddress: v.string(),
    /** The address the library calls its own after the next activation. */
    mainAddress: v.string(),
    /** The chosen main domain stopped working, so it will not be applied. */
    mainNeedsAttention: v.boolean(),
    live: v.boolean(),
    domains: v.array(domainRowValidator),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const binding = await readRuntimeBinding(ctx, access.library);
    const rows = await readEvidenceLibraryDomains(ctx, args.libraryId);
    const sortedRows = rows.sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    const existingHosts = new Set(rows.map(({ host }) => host));
    const apexHosts = new Set(
      rows.filter((row) => row.isApex).map(({ host }) => host),
    );
    const shownVerificationHosts = new Set<string>();
    const draft = await readLibraryDraft(ctx, args.libraryId);
    const plan = await readDomainActivationPlan(ctx, {
      library: access.library,
      binding,
      draft,
    });
    const chosenId = draft?.mainDomainId;
    const chosen = chosenId ? rows.find((row) => row._id === chosenId) : null;
    return {
      platformAddress: binding.targetBaseUrl,
      canonicalAddress: binding.canonicalBaseUrl ?? binding.targetBaseUrl,
      mainAddress: plan.mainAddress,
      mainNeedsAttention:
        typeof chosenId === "string" &&
        (!chosen || plan.mainAddress !== `https://${chosen.host}`),
      live: access.library.state === "active" && binding.state === "ready",
      domains: sortedRows.map((row) => {
        const verificationHost = row.verificationHost;
        const includeVerificationRecord =
          !shownVerificationHosts.has(verificationHost) &&
          (row.isApex || !apexHosts.has(verificationHost));
        if (includeVerificationRecord) {
          shownVerificationHosts.add(verificationHost);
        }
        return presentDomain(
          row,
          existingHosts,
          includeVerificationRecord,
          plan.mainAddress,
        );
      }),
    };
  },
});

async function readLibraryDraft(
  ctx: QueryCtx | MutationCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  return await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (index) => index.eq("libraryId", libraryId))
    .unique();
}

/**
 * Chooses the address the library calls its own. Saved at once, applied by
 * the next activation, so it goes live together with everything else and
 * signs visitors out only then.
 */
export const chooseMainAddress = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    /** A working domain of this library, or null for the platform address. */
    domainId: v.union(v.id("evidenceLibraryDomains"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const draft = await readLibraryDraft(ctx, args.libraryId);
    if (!draft) {
      throw createError("NOT_FOUND", "Evidence Library draft not found");
    }
    if (args.domainId !== null) {
      const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
      if (!row || row.libraryId !== args.libraryId) {
        throw createError("NOT_FOUND", "That domain is not on this library");
      }
      if (
        row.state !== "active" ||
        row.removingAt !== undefined ||
        row.removeOnActivateAt !== undefined
      ) {
        throw createError(
          "CONFLICT",
          "Only a working domain can be the main address",
        );
      }
    }
    await ctx.db.patch(draft._id, {
      mainDomainId: args.domainId,
      updatedByClerkUserId: access.clerkUserId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Removes the library's main address the way every other setting changes:
 * the next activation moves the library to another address, then the domain
 * goes by itself. Pressed again, it keeps the domain.
 */
export const stageMainDomainRemoval = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    remove: v.boolean(),
  },
  returns: v.null(),
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
    if (!args.remove && row.removingAt !== undefined) {
      throw createError("CONFLICT", "That domain is already being removed");
    }
    const now = Date.now();
    await ctx.db.patch(args.domainId, {
      removeOnActivateAt: args.remove ? (row.removeOnActivateAt ?? now) : undefined,
      updatedAt: now,
    });
    if (!args.remove) return null;
    // The library needs another address to move to: the next working domain,
    // or the platform address.
    const draft = await readLibraryDraft(ctx, args.libraryId);
    if (!draft) return null;
    const chosenIsThis =
      draft.mainDomainId === args.domainId ||
      (draft.mainDomainId === undefined && row.role === "primary");
    if (!chosenIsThis) return null;
    const next = (await readEvidenceLibraryDomains(ctx, args.libraryId))
      .filter(
        (entry) =>
          entry._id !== args.domainId &&
          entry.state === "active" &&
          entry.removingAt === undefined &&
          entry.removeOnActivateAt === undefined,
      )
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    await ctx.db.patch(draft._id, {
      mainDomainId: next?._id ?? null,
      updatedByClerkUserId: access.clerkUserId,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * The first domain a library gets working becomes its main address at the
 * next activation, unless the owner already chose one.
 */
export async function suggestFirstMainAddress(
  ctx: MutationCtx,
  domainId: Id<"evidenceLibraryDomains">,
): Promise<void> {
  const row = await ctx.db.get("evidenceLibraryDomains", domainId);
  if (!row || row.state !== "active" || row.removeOnActivateAt !== undefined) {
    return;
  }
  const library = await ctx.db.get("evidenceLibraries", row.libraryId);
  const binding = library?.runtimeBindingId
    ? await ctx.db.get(
        "evidenceLibraryRuntimeBindings",
        library.runtimeBindingId,
      )
    : null;
  if (!library || library.state !== "active" || !binding) return;
  if (binding.canonicalBaseUrl !== undefined) return;
  const draft = await readLibraryDraft(ctx, row.libraryId);
  if (!draft || draft.mainDomainId !== undefined) return;
  const others = (await readEvidenceLibraryDomains(ctx, row.libraryId)).some(
    (entry) => entry._id !== row._id && entry.state === "active",
  );
  if (others) return;
  await ctx.db.patch(draft._id, { mainDomainId: row._id });
}

/** Removed main addresses the library no longer calls its own. */
export const readStagedRemovals = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    /** Only removals the activation that just finished carried. */
    stagedBefore: v.number(),
  },
  returns: v.array(v.id("evidenceLibraryDomains")),
  handler: async (ctx, args) =>
    (await readEvidenceLibraryDomains(ctx, args.libraryId))
      .filter((row) => isStagedBefore(row, args.stagedBefore))
      .map((row) => row._id),
});

/** Removed by the owner before that moment, and no longer the main address. */
export function isStagedBefore(
  row: Doc<"evidenceLibraryDomains">,
  stagedBefore: number,
): boolean {
  return (
    row.removeOnActivateAt !== undefined &&
    row.removeOnActivateAt <= stagedBefore &&
    row.role !== "primary"
  );
}

/**
 * The whole picture one domain action needs, read in one go: the row, the
 * library's addresses, the hosts the proxy already serves for it, and the
 * revision it is running.
 */
type DomainContext = {
  platformAddress: string;
  canonicalAddress: string;
  applicationUuid: string | null;
  runtimeCommit: string | null;
  liveRevisionKey: string | null;
  attachedHosts: string[];
  uncertainHosts: string[];
  domains: Array<{
    domainId: Id<"evidenceLibraryDomains">;
    host: string;
    role: "primary" | "redirect";
    state: "added" | "pointing" | "verified" | "active" | "failed";
    verificationToken: string;
    verificationHost: string;
    isApex: boolean;
    attached: boolean;
    attachIntent: boolean;
    removing: boolean;
    deploymentPending: boolean;
    recoverableDeployment: boolean;
    generation: number;
  }>;
  domain: DomainContext["domains"][number] | null;
};

function presentDomainContextRow(row: Doc<"evidenceLibraryDomains">) {
  return {
    domainId: row._id,
    host: row.host,
    role: row.role,
    state: row.state,
    verificationToken: row.verificationToken,
    verificationHost: row.verificationHost,
    isApex: row.isApex === true,
    attached: row.attachedAt !== undefined,
    attachIntent: row.attachIntentAt !== undefined,
    removing: row.removingAt !== undefined,
    deploymentPending:
      row.deploymentPending === true || row.pendingDeployment !== undefined,
    recoverableDeployment:
      row.pendingDeployment?.phase === "attach" ||
      (row.pendingDeployment === undefined && row.deploymentPending === true),
    generation: row.generation,
  };
}

export const readDomainContext = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.optional(v.id("evidenceLibraryDomains")),
    platform: v.optional(v.literal(true)),
  },
  returns: v.object({
    platformAddress: v.string(),
    canonicalAddress: v.string(),
    applicationUuid: v.union(v.string(), v.null()),
    runtimeCommit: v.union(v.string(), v.null()),
    liveRevisionKey: v.union(v.string(), v.null()),
    attachedHosts: v.array(v.string()),
    uncertainHosts: v.array(v.string()),
    domains: v.array(domainContextRowValidator),
    domain: v.union(domainContextRowValidator, v.null()),
  }),
  handler: async (ctx, args): Promise<DomainContext> => {
    const access = await requireDomainLibraryAccess(
      ctx,
      args.libraryId,
      args.platform,
    );
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
      runtimeCommit: "runtimeCommit" in binding ? binding.runtimeCommit : null,
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
      domains: rows.map(presentDomainContextRow),
      domain: row ? presentDomainContextRow(row) : null,
    };
  },
});

function createVerificationToken(): string {
  const bytes = new Uint8Array(VERIFICATION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

/**
 * Claims the host for this library, in one transaction. The action checked
 * the same things a moment earlier; this re-check is what makes the claim
 * safe when two owners press the button at the same time.
 */
export const claimDomainHost = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    host: v.string(),
    isApex: v.boolean(),
    verificationHost: v.string(),
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
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
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
      isApex: args.isApex,
      verificationHost: args.verificationHost,
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
    platform: v.optional(v.literal(true)),
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
    const access = await requireDomainLibraryAccess(
      ctx,
      args.libraryId,
      args.platform,
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

/** Takes every incomplete domain together so one click cannot start races. */
export const claimDomainTransitions = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainIds: v.array(v.id("evidenceLibraryDomains")),
  },
  returns: v.union(
    v.object({
      status: v.literal("claimed"),
      claims: v.array(
        v.object({
          domainId: v.id("evidenceLibraryDomains"),
          token: v.string(),
          generation: v.number(),
        }),
      ),
    }),
    v.object({ status: v.literal("busy") }),
  ),
  handler: async (ctx, args) => {
    if (
      args.domainIds.length > MAX_EVIDENCE_LIBRARY_DOMAINS ||
      new Set(args.domainIds).size !== args.domainIds.length
    ) {
      throw createError("VALIDATION_ERROR", "Invalid domain check request");
    }
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
    const rows = await Promise.all(
      args.domainIds.map((domainId) => ctx.db.get(domainId)),
    );
    if (rows.some((row) => !row || row.libraryId !== args.libraryId)) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    const now = Date.now();
    const claimable = rows.filter(
      (row) =>
        row!.removingAt === undefined &&
        !(
          row!.transition !== undefined &&
          (row!.transition.expiresAt > now ||
            row!.pendingDeployment !== undefined)
        ),
    );
    if (claimable.length !== rows.length) {
      return { status: "busy" as const };
    }
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
    for (const row of claimable) {
      await rateLimit(ctx, {
        name: "domain-check-host",
        key: row!.host,
        throws: true,
      });
    }
    const claims = await Promise.all(
      claimable.map(async (row) => {
        const claim = await claimDomainTransitionRow(ctx, row!, "check");
        await claim.write();
        return {
          domainId: row!._id,
          token: claim.token,
          generation: claim.generation,
        };
      }),
    );
    return { status: "claimed" as const, claims };
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
      transition: {
        ...row.transition,
        expiresAt: Date.now() + DOMAIN_CHECK_LEASE_MS,
      },
    });
    return null;
  },
});

/**
 * Proves this change still owns the domain, and puts its lease forward.
 *
 * Called immediately before anything outside OpenScholar is written, so a
 * worker that was overtaken — or whose lease ran out while it was slow —
 * stops here instead of writing to the proxy on behalf of a change that is
 * no longer happening.
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
 * Writes what a check found. Never touches the proxy, and
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
      checkedAt: now,
      updatedAt: now,
      ...(args.state === "active" && row.activatedAt === undefined
        ? { activatedAt: now }
        : {}),
    });
    if (args.state === "active") {
      await suggestFirstMainAddress(ctx, args.domainId);
    }
    return null;
  },
});

/** Clears a stale failed deployment after the live route proves it already landed. */
export const recoverLiveDomain = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
    expectedGeneration: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    requireTransition(row, args.token);
    if (
      row.generation !== args.expectedGeneration ||
      row.attachedAt === undefined ||
      row.removingAt !== undefined ||
      (row.deploymentPending !== true && row.pendingDeployment === undefined)
    ) {
      throw createError("CONFLICT", "That domain changed while it was checked");
    }
    if (row.pendingDeployment) {
      if (row.pendingDeployment.phase !== "attach") {
        throw createError("CONFLICT", "That domain has another change pending");
      }
      const operation = await ctx.db.get(row.pendingDeployment.operationId);
      if (!operation || operation.status !== "failed") {
        throw createError(
          "CONFLICT",
          "That domain deployment is still running",
        );
      }
    }
    const now = Date.now();
    await ctx.db.patch(args.domainId, {
      state: "active",
      failure: undefined,
      deploymentPending: undefined,
      pendingDeployment: undefined,
      transition: undefined,
      checkedAt: now,
      activatedAt: row.activatedAt ?? now,
      updatedAt: now,
    });
    await suggestFirstMainAddress(ctx, args.domainId);
    return null;
  },
});

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
    platform: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireDomainLibraryAccess(ctx, args.libraryId, args.platform);
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    // A receipt from a step that has been overtaken is refused, so a check
    // cannot reattach a domain a removal already took out.
    requireTransition(row, args.token);
    await ctx.db.patch(args.domainId, {
      attachedAt: args.attached ? (row.attachedAt ?? Date.now()) : undefined,
      deploymentPending: args.deploymentPending ? true : undefined,
      // The proxy has answered, so the note that it was asked has done its
      // job. Cleared only here, never before the answer.
      attachIntentAt: undefined,
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
  if (
    args.outcome === "succeeded" &&
    row.pendingDeployment?.phase === "detach"
  ) {
    if (
      row.removingAt === undefined ||
      row.role === "primary" ||
      row.attachedAt !== undefined ||
      row.deploymentPending === true
    ) {
      throw createError("CONFLICT", "That domain is still being served");
    }
    await ctx.db.delete(args.domainId);
    return;
  }
  await ctx.db.patch(args.domainId, {
    // A failed deployment still owes its change, so the record of it stays;
    // only a successful one is settled.
    ...(args.outcome === "succeeded" ? { pendingDeployment: undefined } : {}),
    // Either way the change is over, so the domain is free again.
    transition: undefined,
    updatedAt: Date.now(),
  });
}

/** Settles every domain carried by one batched proxy deployment. */
export async function settleDomainDeploymentRows(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    anchor: {
      domainId: Id<"evidenceLibraryDomains">;
      token: string;
    };
    outcome: "succeeded" | "failed";
  },
): Promise<Id<"evidenceLibraryDomains">[]> {
  const rows = (await readEvidenceLibraryDomains(ctx, args.libraryId)).filter(
    (row) => row.pendingDeployment?.operationId === args.operationId,
  );
  const attached = rows
    .filter((row) => row.pendingDeployment?.phase === "attach")
    .map((row) => row._id);
  if (rows.length === 0 && args.outcome === "succeeded") {
    const anchor = await ctx.db.get(args.anchor.domainId);
    if (anchor) {
      throw createError(
        "CONFLICT",
        "Another change took that domain while this one was being applied",
      );
    }
  }
  for (const row of rows) {
    if (
      row._id === args.anchor.domainId &&
      row.pendingDeployment!.token !== args.anchor.token
    ) {
      throw createError(
        "CONFLICT",
        "Another change took that domain while this one was being applied",
      );
    }
    await settleDomainDeploymentRow(ctx, {
      domainId: row._id,
      operationId: args.operationId,
      token: row.pendingDeployment!.token,
      outcome: args.outcome,
    });
  }
  return attached;
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
    platform: v.optional(v.literal(true)),
    /** The platform removes only what the owner still has staged. */
    stagedBefore: v.optional(v.number()),
  },
  returns: v.union(
    v.object({ status: v.literal("removing"), attached: v.boolean() }),
    v.object({ status: v.literal("gone") }),
    v.object({ status: v.literal("kept") }),
  ),
  handler: async (ctx, args) => {
    await requireDomainLibraryAccess(ctx, args.libraryId, args.platform);
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      return { status: "gone" as const };
    }
    requireTransition(row, args.token);
    if (
      args.stagedBefore !== undefined &&
      !isStagedBefore(row, args.stagedBefore)
    ) {
      return { status: "kept" as const };
    }
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

const DOMAIN_ROUTE_LEASE_MS = 60_000;

/**
 * Takes the right to write this library's custom-domain route file and hands
 * back what it should say: every attached domain that is not on its way out,
 * read now. Refused while a configuration deployment runs, because that
 * deployment writes the same file from its own copy when it finishes.
 */
export const claimDomainRoutes = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    platform: v.optional(v.literal(true)),
  },
  returns: v.union(
    v.object({
      status: v.literal("claimed"),
      token: v.string(),
      applicationUuid: v.string(),
      hosts: v.array(v.string()),
    }),
    v.object({ status: v.literal("busy") }),
  ),
  handler: async (ctx, args) => {
    const access = await requireDomainLibraryAccess(
      ctx,
      args.libraryId,
      args.platform,
    );
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
    const binding = await readRuntimeBinding(ctx, access.library);
    if (!("targetRuntimeId" in binding) || !binding.targetRuntimeId) {
      throw createError("CONFLICT", "This library is not running yet");
    }
    for (const status of ["queued", "running"] as const) {
      const operations = ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_status_and_updatedAt", (index) =>
          index.eq("libraryId", args.libraryId).eq("status", status),
        );
      for await (const operation of operations) {
        if (isConfigurationDeploymentOperation(operation)) {
          return { status: "busy" as const };
        }
      }
    }
    const now = Date.now();
    const held = await ctx.db
      .query("evidenceLibraryDomainRouteLeases")
      .withIndex("by_libraryId", (index) =>
        index.eq("libraryId", args.libraryId),
      )
      .unique();
    if (held && held.expiresAt > now) return { status: "busy" as const };
    const token = createTransitionToken();
    if (held) {
      await ctx.db.patch(held._id, {
        token,
        expiresAt: now + DOMAIN_ROUTE_LEASE_MS,
      });
    } else {
      await ctx.db.insert("evidenceLibraryDomainRouteLeases", {
        libraryId: args.libraryId,
        token,
        expiresAt: now + DOMAIN_ROUTE_LEASE_MS,
      });
    }
    const hosts = (await readEvidenceLibraryDomains(ctx, args.libraryId))
      .filter((row) => row.attachedAt !== undefined && row.removingAt === undefined)
      .map((row) => `https://${row.host}`)
      .sort();
    return {
      status: "claimed" as const,
      token,
      applicationUuid: binding.targetRuntimeId,
      hosts,
    };
  },
});

export const releaseDomainRoutes = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const held = await ctx.db
      .query("evidenceLibraryDomainRouteLeases")
      .withIndex("by_libraryId", (index) =>
        index.eq("libraryId", args.libraryId),
      )
      .unique();
    if (held && held.token === args.token) await ctx.db.delete(held._id);
    return null;
  },
});

/**
 * Records that the route file now carries this domain's change, so nothing
 * is owed any more — including a deployment that failed earlier and was
 * still on record for it.
 */
export const settleRoutedDomain = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    token: v.string(),
    attached: v.boolean(),
    platform: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireDomainLibraryAccess(ctx, args.libraryId, args.platform);
    await requireLibraryNotBeingDeleted(ctx, args.libraryId);
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    requireTransition(row, args.token);
    if (row.pendingDeployment) {
      const operation = await ctx.db.get(row.pendingDeployment.operationId);
      if (
        operation &&
        (operation.status === "queued" || operation.status === "running")
      ) {
        throw createError(
          "CONFLICT",
          "That domain's deployment is still running",
        );
      }
    }
    await ctx.db.patch(args.domainId, {
      attachedAt: args.attached ? (row.attachedAt ?? Date.now()) : undefined,
      deploymentPending: undefined,
      pendingDeployment: undefined,
      attachIntentAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The last step of a removal: the row goes once nothing else holds the host. */
export const finishDomainRemoval = internalMutation({
  args: {
    domainId: v.id("evidenceLibraryDomains"),
    /** The removal doing this. Checked again right before the row goes. */
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

/** Rows a finished deployment should prove over HTTPS without another click. */
export const readDomainsForActivation = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainIds: v.array(v.id("evidenceLibraryDomains")),
  },
  returns: v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      host: v.string(),
      generation: v.number(),
      runtimeCommit: v.string(),
      liveRevisionKey: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.domainIds.length > MAX_EVIDENCE_LIBRARY_DOMAINS) return [];
    const library = await ctx.db.get(args.libraryId);
    const revision = library?.activeRevisionId
      ? await ctx.db.get(library.activeRevisionId)
      : null;
    const binding = library?.runtimeBindingId
      ? await ctx.db.get(library.runtimeBindingId)
      : null;
    if (
      !library ||
      library.state !== "active" ||
      !revision ||
      !binding ||
      !("runtimeCommit" in binding)
    ) {
      return [];
    }
    const rows = await Promise.all(
      args.domainIds.map((domainId) => ctx.db.get(domainId)),
    );
    return rows.flatMap((row) =>
      row &&
      row.libraryId === args.libraryId &&
      row.state === "verified" &&
      row.attachedAt !== undefined &&
      row.removingAt === undefined &&
      row.pendingDeployment === undefined &&
      row.deploymentPending !== true
        ? [
            {
              domainId: row._id,
              host: row.host,
              generation: row.generation,
              runtimeCommit: binding.runtimeCommit,
              liveRevisionKey: revision.revisionKey,
            },
          ]
        : [],
    );
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
        runtimeCommit: v.union(v.string(), v.null()),
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
        const binding = library.runtimeBindingId
          ? await ctx.db.get(library.runtimeBindingId)
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
          runtimeCommit:
            binding && "runtimeCommit" in binding
              ? binding.runtimeCommit
              : null,
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
    const now = Date.now();
    await ctx.db.patch(args.domainId, {
      state: args.state,
      failure: args.failure,
      ...(args.state === "active" && row.activatedAt === undefined
        ? { activatedAt: now }
        : {}),
      // The domain has moved on, so a second sweep still holding the old
      // count cannot land its answer on top of this one.
      generation: row.generation + 1,
      checkedAt: now,
      updatedAt: now,
    });
    if (args.state === "active") {
      await suggestFirstMainAddress(ctx, args.domainId);
    }
    return { written: true };
  },
});
