import { z } from "zod";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { requireEvidenceLibraryAccess, readLibraryRole, readPendingLibraryInvitations } from "./access";
import { getCurrentUser } from "../lib/auth";
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
    const expiresAt = Date.now() + 7 * 86400000;
    const invitationId = pending?._id ?? await ctx.db.insert("evidenceLibraryInvitations", { ...args, email, invitedBy: access.clerkUserId, expiresAt, state: "pending", delivery: "queued" });
    if (pending) await ctx.db.patch("evidenceLibraryInvitations", pending._id, { role: args.role, invitedBy: access.clerkUserId, expiresAt, delivery: "queued" });
    await ctx.scheduler.runAt(expiresAt, internal.evidenceLibraries.invitations.expire, { invitationId });
    return invitationId;
  },
});

/**
 * Marks an invitation expired once its time is up, so lists filter on its state and
 * never on the clock. A re-sent invitation has a later time and waits for its own run.
 */
export const expire = internalMutation({
  args: { invitationId: v.id("evidenceLibraryInvitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get("evidenceLibraryInvitations", invitationId);
    if (invitation?.state === "pending" && invitation.expiresAt <= Date.now()) await ctx.db.patch("evidenceLibraryInvitations", invitationId, { state: "expired" });
    return null;
  },
});

export const readDelivery = internalQuery({
  args: { invitationId: v.id("evidenceLibraryInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("evidenceLibraryInvitations", args.invitationId);
    if (!invitation || invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return null;
    const access = await requireEvidenceLibraryAccess(ctx, invitation.libraryId, "manage");
    const revisionId = access.library.activeRevisionId ?? access.library.latestRevisionId;
    const [contact, identitySection, themeSection] = await Promise.all(
      (["contact", "identity", "theme"] as const).map(sectionKey => revisionId ? ctx.db.query("evidenceLibraryConfigSections")
        .withIndex("by_revisionId_and_sectionKey", q => q.eq("revisionId", revisionId).eq("sectionKey", sectionKey)).unique() : null),
    );
    const identity = z.object({baseUrl: z.url(), assets: z.object({icons: z.array(z.string()).optional(), logoLight: z.string().optional(), logoDark: z.string().optional()}).optional()}).safeParse(identitySection?.payload);
    const theme = z.object({colors: z.object({accent: z.string()})}).safeParse(themeSection?.payload);
    const assets = identity.success ? identity.data.assets : undefined;
    return {
      email: invitation.email, libraryName: access.library.name,
      contactEmail: typeof contact?.payload.email === "string" ? contact.payload.email : null, role: invitation.role,
      emailIdentity: {name: access.library.name, baseUrl: identity.success ? identity.data.baseUrl : null,
        logoUrl: assets?.icons?.find(icon => /\.png(?:\?|$)/.test(icon)) || assets?.logoLight || assets?.logoDark || "",
        accent: theme.success ? theme.data.colors.accent : "#f58220"},
    };
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
  returns: v.array(v.object({
    invitationId: v.id("evidenceLibraryInvitations"), libraryId: v.id("evidenceLibraries"), name: v.string(),
    role: v.union(v.literal("editor"), v.literal("creator")),
    organization: v.object({ name: v.string(), imageUrl: v.union(v.string(), v.null()) }),
  })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await readPendingLibraryInvitations(ctx, user) : [];
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
