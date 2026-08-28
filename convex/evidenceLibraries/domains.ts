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

const domainRowValidator = v.object({
  domainId: v.id("evidenceLibraryDomains"),
  host: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: evidenceLibraryDomainStateValidator,
  failure: v.optional(evidenceLibraryDomainFailureValidator),
  certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  attached: v.boolean(),
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
        certificateHostnameId: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
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

/** Writes what a check found. Never touches the proxy or the certificate. */
export const writeDomainCheck = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    state: evidenceLibraryDomainStateValidator,
    failure: v.optional(evidenceLibraryDomainFailureValidator),
    certificateState: v.optional(evidenceLibraryCertificateStateValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) {
      throw createError("NOT_FOUND", "That domain is not on this library");
    }
    const now = Date.now();
    await ctx.db.patch(args.domainId, {
      state: args.state,
      failure: args.failure,
      certificateState: args.certificateState ?? row.certificateState,
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
export const writeDomainAttachment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
    attached: v.boolean(),
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
    await ctx.db.patch(args.domainId, {
      attachedAt: args.attached ? (row.attachedAt ?? Date.now()) : undefined,
      certificateHostnameId: args.attached
        ? (args.certificateHostnameId ?? row.certificateHostnameId)
        : undefined,
      certificateState: args.attached
        ? (args.certificateState ?? row.certificateState)
        : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const dropDomain = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    domainId: v.id("evidenceLibraryDomains"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const row = await ctx.db.get("evidenceLibraryDomains", args.domainId);
    if (!row || row.libraryId !== args.libraryId) return null;
    if (row.role === "primary") {
      throw createError(
        "CONFLICT",
        "Send the platform address back to itself before removing this domain",
      );
    }
    await ctx.db.delete(args.domainId);
    return null;
  },
});

/**
 * The domains a sweep should re-check: the ones the platform currently says
 * are working. No caller identity: this runs on a schedule.
 */
export const listWorkingDomains = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      libraryId: v.id("evidenceLibraries"),
      host: v.string(),
      liveRevisionKey: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("evidenceLibraryDomains")
      .withIndex("by_state", (index) => index.eq("state", "active"))
      .take(Math.min(Math.max(args.limit, 1), 50));
    return await Promise.all(
      rows.map(async (row) => {
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
          liveRevisionKey: revision?.revisionKey ?? null,
        };
      }),
    );
  },
});

/** Writes one sweep result. The row keeps its history: only the last check moves. */
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
