import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { personName } from "../lib/people";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { countOf, PENDING_WALLET_KEY, walletKeysOf } from "../lib/listCounts";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";

/**
 * Check if a redirect origin is registered in the allowlist.
 * Used by the /connect page before showing the consent screen.
 */
export const isOriginAllowed = query({
  args: { origin: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const allowed = await ctx.db
      .query("walletAllowedOrigins")
      .withIndex("by_origin", (q) => q.eq("origin", args.origin))
      .unique();
    return !!allowed;
  },
});

const walletKeyValidator = v.object({
  _id: v.id("walletKeys"),
  keyPrefix: v.string(),
  appName: v.string(),
  redirectOrigin: v.string(),
  isActive: v.boolean(),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  /** The workspace the app draws on (#651): the person's own, or an organization. */
  workspace: v.object({ kind: v.union(v.literal("personal"), v.literal("organization")), name: v.string(), imageUrl: v.optional(v.string()) }),
});

/** A workspace as a connected app's tag names it: its person's for their own, an organization's otherwise. */
async function workspaceTag(ctx: QueryCtx, userId: Id<"users">, workspaceId: Id<"workspaces"> | undefined) {
  const workspace = workspaceId ? await ctx.db.get("workspaces", workspaceId) : null;
  const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
  if (organization) return { kind: "organization" as const, name: organization.name, ...(organization.imageUrl ? { imageUrl: organization.imageUrl } : {}) };
  const user = await ctx.db.get("users", userId);
  return { kind: "personal" as const, name: user ? personName(user) || user.email : "", ...(user?.avatarUrl ? { imageUrl: user.avatarUrl } : {}) };
}

/** Most keys one page holds, and the rows one read of it takes past keys still being made. */
const KEYS_PAGE_MAX = 50;
const KEYS_ROWS_READ = 500;

export const listKeysAction = defineUserQuery({
  path: "wallet/queries:listKeys",
  description:
    "Lists the apps connected to the person's account with a wallet key, newest first, a page at a time: the active keys, or the revoked ones, each with the workspace whose credits it draws on. " +
    "A key shows its first characters only.",
  args: { paginationOpts: paginationOptsValidator, active: v.boolean() },
  returns: paginationResultValidator(walletKeyValidator),
  run: async (ctx, { userId }, { paginationOpts, active }) =>
    await stream(ctx.db, schema)
      .query("walletKeys")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", active))
      .order("desc")
      .filterWith(async (key) => key.hashedKey !== PENDING_WALLET_KEY)
      .map(async ({ _id, keyPrefix, appName, redirectOrigin, isActive, lastUsedAt, createdAt, workspaceId }) => ({ _id, keyPrefix, appName, redirectOrigin, isActive, lastUsedAt, createdAt, workspace: await workspaceTag(ctx, userId, workspaceId) }))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, KEYS_PAGE_MAX), maximumRowsRead: KEYS_ROWS_READ }),
});
export const listKeys = userQuery(listKeysAction);
export const listKeysForAssistant = assistantQuery(listKeysAction);

export const countKeysAction = defineUserQuery({
  path: "wallet/queries:countKeys",
  description: "Says how many wallet keys the person has: the active ones and the revoked ones.",
  args: {},
  returns: v.object({ active: v.number(), revoked: v.number() }),
  run: async (ctx, { userId }) => {
    const [active, revoked] = await Promise.all([countOf(ctx, walletKeysOf(userId, true)), countOf(ctx, walletKeysOf(userId, false))]);
    return { active, revoked };
  },
});
export const countKeys = userQuery(countKeysAction);
export const countKeysForAssistant = assistantQuery(countKeysAction);
