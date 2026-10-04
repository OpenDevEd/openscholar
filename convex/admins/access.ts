import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function isAdmin(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<boolean> {
  const row = await ctx.db
    .query("admins")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row !== null;
}

/** Refuses unless `userId` is an admin: for actions that take the acting user. */
export async function requireAdminUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  if (!(await isAdmin(ctx, userId))) throw createError("FORBIDDEN", "Admins only");
}

/** The signed-in user, if they're an admin. Throws FORBIDDEN otherwise. */
export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
  await requireAdminUser(ctx, user._id);
  return user;
}

/**
 * Links an invite to the user who owns its email. Called whenever Clerk reports
 * a user, with only the addresses Clerk has verified, so an invited person is an
 * admin from their first sign-in and nobody claims an invite with an address
 * they haven't proven.
 */
export async function claimAdminInvite(
  ctx: MutationCtx,
  userId: Id<"users">,
  primaryEmail: string,
  verifiedEmails: readonly string[],
) {
  const membership = await ctx.db
    .query("admins")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (membership) {
    // Keep the stored email current, so it never matches someone else's invite.
    if (membership.email !== normalizeEmail(primaryEmail)) {
      await ctx.db.patch("admins", membership._id, { email: normalizeEmail(primaryEmail) });
    }
    return;
  }
  for (const email of verifiedEmails) {
    const invite = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
      .first();
    if (invite && invite.userId === undefined) {
      await ctx.db.patch("admins", invite._id, { userId });
      return;
    }
  }
}
