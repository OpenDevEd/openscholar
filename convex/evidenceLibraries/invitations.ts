import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { requireEvidenceLibraryAccess, readLibraryRole } from "./access";
import { rateLimit } from "../lib/rateLimit";
import { createError } from "../lib/errors";

const roleValidator = v.union(v.literal("editor"), v.literal("creator"));
const invitationArgs = { libraryId: v.id("evidenceLibraries"), email: v.string(), role: roleValidator };

export const prepare = internalMutation({
  args: invitationArgs,
  returns: v.id("evidenceLibraryInvitations"),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    await rateLimit(ctx, { name: "library-invitation", key: args.libraryId, throws: true });
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError("VALIDATION_ERROR", "Enter a valid email address");
    const users = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", email)).collect();
    for (const user of users) {
      if (await readLibraryRole(ctx, access.library, user.clerkId)) throw createError("CONFLICT", "This person already has library access");
    }
    const invitations = await ctx.db.query("evidenceLibraryInvitations")
      .withIndex("by_libraryId_and_email", q => q.eq("libraryId", args.libraryId).eq("email", email)).collect();
    const pending = invitations.find(i => i.state === "pending");
    if (pending) {
      await ctx.db.patch("evidenceLibraryInvitations", pending._id, { role: args.role, invitedBy: access.clerkUserId, expiresAt: Date.now() + 7 * 86400000, delivery: "queued" });
      return pending._id;
    }
    return await ctx.db.insert("evidenceLibraryInvitations", { ...args, email, invitedBy: access.clerkUserId, expiresAt: Date.now() + 7 * 86400000, state: "pending", delivery: "queued" });
  },
});

export const readDelivery = internalQuery({
  args: { invitationId: v.id("evidenceLibraryInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("evidenceLibraryInvitations", args.invitationId);
    if (!invitation || invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return null;
    const access = await requireEvidenceLibraryAccess(ctx, invitation.libraryId, "manage");
    return { email: invitation.email, libraryName: access.library.name, role: invitation.role };
  },
});

export const recordDelivery = internalMutation({
  args: { invitationId: v.id("evidenceLibraryInvitations"), delivery: v.union(v.literal("sent"), v.literal("failed")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("evidenceLibraryInvitations", args.invitationId);
    if (invitation?.state === "pending") await ctx.db.patch("evidenceLibraryInvitations", args.invitationId, { delivery: args.delivery });
    return null;
  },
});

export const change = mutation({
  args: { invitationId: v.id("evidenceLibraryInvitations"), role: v.optional(roleValidator), cancel: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("evidenceLibraryInvitations", args.invitationId);
    if (!invitation) throw createError("NOT_FOUND", "Invitation not found");
    await requireEvidenceLibraryAccess(ctx, invitation.libraryId, "manage");
    if (invitation.state !== "pending") throw createError("CONFLICT", "Invitation is no longer pending");
    await ctx.db.patch("evidenceLibraryInvitations", args.invitationId, {
      ...(args.role ? { role: args.role } : {}), ...(args.cancel ? { state: "cancelled" as const } : {}),
    });
    return null;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", identity.subject)).unique();
    if (!user) return [];
    const invitations = await ctx.db.query("evidenceLibraryInvitations")
      .withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).collect();
    const rows = await Promise.all(invitations.filter(i => i.expiresAt > Date.now()).map(async invitation => {
      const library = await ctx.db.get("evidenceLibraries", invitation.libraryId);
      if (!library || library.state === "disabled") return null;
      const organization = await ctx.db.get("organizations", library.organizationId);
      if (organization?.state !== "active") return null;
      return { invitationId: invitation._id, libraryId: library._id, name: library.name, role: invitation.role, organization: { name: organization.name, imageUrl: organization.imageUrl ?? null } };
    }));
    return rows.filter(row => row !== null);
  },
});

/** Called only after Clerk confirms a verified address on the signed-in account. */
export const respondVerified = internalMutation({
  args: { invitationId: v.id("evidenceLibraryInvitations"), emails: v.array(v.string()), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Sign in to respond");
    const invitation = await ctx.db.get("evidenceLibraryInvitations", args.invitationId);
    if (!invitation || !args.emails.includes(invitation.email)) throw createError("FORBIDDEN", "Sign in with the invited email address");
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) throw createError("CONFLICT", "Invitation expired or already answered");
    const library = await ctx.db.get("evidenceLibraries", invitation.libraryId);
    const org = library && await ctx.db.get("organizations", library.organizationId);
    if (!library || library.state === "disabled" || org?.state !== "active") throw createError("FORBIDDEN", "Library unavailable");
    if (args.accept) {
      const member = await ctx.db.query("evidenceLibraryMembers").withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", invitation.libraryId).eq("clerkUserId", identity.subject)).unique();
      // An outstanding invitation cannot overwrite a role granted since it was sent.
      if (!member) await ctx.db.insert("evidenceLibraryMembers", { libraryId: invitation.libraryId, clerkUserId: identity.subject, role: invitation.role, grantedBy: invitation.invitedBy, grantedAt: Date.now() });
    }
    await ctx.db.patch("evidenceLibraryInvitations", invitation._id, { state: args.accept ? "accepted" : "declined" });
    return null;
  },
});
