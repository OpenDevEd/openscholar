import { query } from "../_generated/server";
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
});

/** Most keys one page holds, and the rows one read of it takes past keys still being made. */
const KEYS_PAGE_MAX = 50;
const KEYS_ROWS_READ = 500;

export const listKeysAction = defineUserQuery({
  path: "wallet/queries:listKeys",
  description:
    "Lists the apps connected to the person's account with a wallet key, newest first, a page at a time: the active keys, or the revoked ones. " +
    "A key shows its first characters only.",
  args: { paginationOpts: paginationOptsValidator, active: v.boolean() },
  returns: paginationResultValidator(walletKeyValidator),
  run: async (ctx, userId, { paginationOpts, active }) =>
    await stream(ctx.db, schema)
      .query("walletKeys")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", active))
      .order("desc")
      .filterWith(async (key) => key.hashedKey !== PENDING_WALLET_KEY)
      .map(async ({ _id, keyPrefix, appName, redirectOrigin, isActive, lastUsedAt, createdAt }) => ({ _id, keyPrefix, appName, redirectOrigin, isActive, lastUsedAt, createdAt }))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, KEYS_PAGE_MAX), maximumRowsRead: KEYS_ROWS_READ }),
});
export const listKeys = userQuery(listKeysAction);
export const listKeysForAssistant = assistantQuery(listKeysAction);

export const countKeysAction = defineUserQuery({
  path: "wallet/queries:countKeys",
  description: "Says how many wallet keys the person has: the active ones and the revoked ones.",
  args: {},
  returns: v.object({ active: v.number(), revoked: v.number() }),
  run: async (ctx, userId) => {
    const [active, revoked] = await Promise.all([countOf(ctx, walletKeysOf(userId, true)), countOf(ctx, walletKeysOf(userId, false))]);
    return { active, revoked };
  },
});
export const countKeys = userQuery(countKeysAction);
export const countKeysForAssistant = assistantQuery(countKeysAction);
