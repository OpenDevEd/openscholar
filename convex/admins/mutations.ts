import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { isAdmin, normalizeEmail, requireAdmin } from "./access";

export const addUser = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const me = await requireAdmin(ctx);
    const user = await ctx.db.get("users", userId);
    if (!user || user.state !== "active") throw createError("NOT_FOUND", "No such user");
    if (await isAdmin(ctx, userId)) return null;
    // A pending invite for the same email becomes this admin; someone else's membership is never reused.
    const invite = await findByEmail(ctx, user.email);
    if (invite && !invite.userId) await ctx.db.patch("admins", invite._id, { userId });
    else await ctx.db.insert("admins", { email: normalizeEmail(user.email), userId, addedBy: me._id, createdAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { adminId: v.id("admins") },
  returns: v.null(),
  handler: async (ctx, { adminId }) => {
    const me = await requireAdmin(ctx);
    const row = await ctx.db.get("admins", adminId);
    if (!row) return null;
    if (row.userId === me._id) throw createError("CONFLICT", "You can't remove yourself");
    await ctx.db.delete("admins", adminId);
    return null;
  },
});

/**
 * Records an invite for an email nobody has signed up with yet, or reuses one
 * for a resend. Called by `invitations:invite`; the caller must be an admin.
 */
export const prepareInvite = internalMutation({
  args: { email: v.string() },
  returns: v.id("admins"),
  handler: async (ctx, args): Promise<Id<"admins">> => {
    const me = await requireAdmin(ctx);
    const email = normalizeEmail(args.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError("VALIDATION_ERROR", "Enter an email address");
    const existing = await findByEmail(ctx, email);
    if (existing?.userId) throw createError("CONFLICT", "Already an admin");
    if (existing) return existing._id;
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (user) throw createError("CONFLICT", "This person already has an account; add them as an existing user");
    return await ctx.db.insert("admins", { email, addedBy: me._id, createdAt: Date.now() });
  },
});

/** Checks a resend: the caller is an admin and the invite is still pending. */
export const prepareResend = internalMutation({
  args: { adminId: v.id("admins") },
  returns: v.null(),
  handler: async (ctx, { adminId }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get("admins", adminId);
    if (!row || row.userId) throw createError("CONFLICT", "This invite is no longer pending");
    return null;
  },
});

/** The invite to send, if it's still pending. Callers are checked by `prepareInvite` or `prepareResend`. */
export const readInvite = internalQuery({
  args: { adminId: v.id("admins") },
  returns: v.union(v.object({ email: v.string() }), v.null()),
  handler: async (ctx, { adminId }) => {
    const row = await ctx.db.get("admins", adminId);
    return row && !row.userId ? { email: row.email } : null;
  },
});

export const recordDelivery = internalMutation({
  args: { adminId: v.id("admins"), delivery: v.union(v.literal("sent"), v.literal("failed")) },
  returns: v.null(),
  handler: async (ctx, { adminId, delivery }) => {
    if (await ctx.db.get("admins", adminId)) await ctx.db.patch("admins", adminId, { delivery });
    return null;
  },
});

/**
 * Makes an email an admin from the command line, for the first admin of a
 * deployment: `npx convex run admins/mutations:grant '{"email": "…"}'`.
 */
export const grant = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const existing = await findByEmail(ctx, email);
    if (existing) {
      if (user && !existing.userId) await ctx.db.patch("admins", existing._id, { userId: user._id });
      return null;
    }
    await ctx.db.insert("admins", { email, ...(user ? { userId: user._id } : {}), createdAt: Date.now() });
    return null;
  },
});

async function findByEmail(ctx: MutationCtx, email: string): Promise<Doc<"admins"> | null> {
  return await ctx.db
    .query("admins")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .first();
}
