import { z } from "zod";
import { v } from "convex/values";
import { paginationResultValidator } from "convex/server";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "../lib/functions";
import { actingArg, signedInAs } from "../lib/userActions";
import { grantedRole, libraryGrant, libraryOf, libraryOwner, ownerActive, requireEvidenceLibraryAccess, readLibraryRole, readPendingLibraryInvitations } from "./access";
import { getCurrentUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { createError } from "../lib/errors";
import { assertLibraryHasRoom, assertPersonHasRoom } from "./members";
import { MAX_ACCOUNTS_PER_EMAIL, MAX_PENDING_INVITATIONS_PER_LIBRARY, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import { invitationTo } from "../sharing/access";

const roleValidator = v.union(v.literal("editor"), v.literal("creator"));
const invitationArgs = { libraryId: v.id("evidenceLibraries"), email: v.string(), role: roleValidator };

/** Checks an invitation and keeps it, ready to send. Sending one again restarts its seven days and takes no second place. */
export const prepare = internalMutation({
  args: { ...invitationArgs, ...actingArg },
  returns: v.id("itemInvitations"),
  handler: async (caller, { actingAs: as, ...args }) => {
    const ctx = await signedInAs(caller, as);
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    await rateLimit(ctx, { name: "library-invitation", key: args.libraryId, throws: true });
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError("VALIDATION_ERROR", "Enter a valid email address");
    // A deleted account keeps its address, so one address can name several accounts.
    const users = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", email)).take(MAX_ACCOUNTS_PER_EMAIL + 1);
    if (users.length > MAX_ACCOUNTS_PER_EMAIL) throw createError("VALIDATION_ERROR", "Too many accounts have used this address to check which of them already has access. Invite a different address.");
    for (const user of users) {
      if (await readLibraryRole(ctx, access.library, user.clerkId)) throw createError("CONFLICT", "This person already has library access");
    }
    const inviter = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", access.clerkUserId)).unique();
    if (!inviter) throw createError("UNAUTHENTICATED", "Sign in to invite");
    // One row an address and library, whatever became of the invitation before.
    const existing = await invitationTo(ctx, args.libraryId, email);
    const waits = existing?.state === "pending";
    if (!waits) {
      await assertLibraryHasRoom(ctx, args.libraryId);
      // Both lists of waiting invitations stay small enough to read in one query.
      const waiting = await ctx.db.query("itemInvitations")
        .withIndex("by_item_and_state", q => q.eq("item", args.libraryId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_LIBRARY);
      if (waiting.length >= MAX_PENDING_INVITATIONS_PER_LIBRARY) throw createError("VALIDATION_ERROR", `This library has ${MAX_PENDING_INVITATIONS_PER_LIBRARY} invitations waiting. Cancel one to send another.`);
      const theirs = await ctx.db.query("itemInvitations")
        .withIndex("by_email_and_state", q => q.eq("email", email).eq("state", "pending")).take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);
      if (theirs.length >= MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL) throw createError("VALIDATION_ERROR", "This person has too many invitations waiting. Ask them to answer some first.");
    }
    const values = { kind: "library" as const, item: args.libraryId, email, role: args.role, invitedBy: inviter._id, expiresAt: Date.now() + 7 * 86400000, state: "pending" as const, delivery: "queued" as const };
    const invitationId = existing?._id ?? await ctx.db.insert("itemInvitations", values);
    if (existing) await ctx.db.replace("itemInvitations", existing._id, values);
    // Its time up, it is marked expired, so lists filter on its state and never on the clock (../sharing/invitations.ts).
    await ctx.scheduler.runAt(values.expiresAt, internal.sharing.invitations.expire, { invitationId });
    return invitationId;
  },
});

export const readDelivery = internalQuery({
  args: { ...actingArg, invitationId: v.id("itemInvitations") },
  handler: async (caller, { actingAs: as, ...args }) => {
    const ctx = await signedInAs(caller, as);
    const invitation = await ctx.db.get("itemInvitations", args.invitationId);
    const invited = invitation ? await libraryOf(ctx, invitation) : null;
    if (!invitation || !invited || invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return null;
    const access = await requireEvidenceLibraryAccess(ctx, invited._id, "manage");
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
      contactEmail: typeof contact?.payload.email === "string" ? contact.payload.email : null, role: grantedRole(invitation),
      emailIdentity: {name: access.library.name, baseUrl: identity.success ? identity.data.baseUrl : null,
        logoUrl: assets?.icons?.find(icon => /\.png(?:\?|$)/.test(icon)) || assets?.logoLight || assets?.logoDark || "",
        accent: theme.success ? theme.data.colors.accent : "#f58220"},
    };
  },
});

export const change = mutation({
  args: { invitationId: v.id("itemInvitations"), role: v.optional(roleValidator), cancel: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("itemInvitations", args.invitationId);
    const invited = invitation ? await libraryOf(ctx, invitation) : null;
    if (!invitation || !invited) throw createError("NOT_FOUND", "Invitation not found");
    await requireEvidenceLibraryAccess(ctx, invited._id, "manage");
    if (invitation.state !== "pending") throw createError("CONFLICT", "Invitation is no longer pending");
    await ctx.db.patch("itemInvitations", args.invitationId, {
      ...(args.role ? { role: args.role } : {}), ...(args.cancel ? { state: "cancelled" as const } : {}),
    });
    return null;
  },
});

const pendingInvitationValidator = v.object({
  invitationId: v.id("itemInvitations"), libraryId: v.id("evidenceLibraries"), name: v.string(),
  role: v.union(v.literal("editor"), v.literal("creator")),
  // Who the library belongs to: its organization, or with no ID the person whose own workspace it's in.
  organization: v.object({ id: v.union(v.id("organizations"), v.null()), name: v.string(), imageUrl: v.union(v.string(), v.null()) }),
});
const pendingInvitations = async (ctx: QueryCtx) => {
  const user = await getCurrentUser(ctx);
  return user ? await readPendingLibraryInvitations(ctx, user) : [];
};

/** The library invitations waiting for the person, as one page: an address has at most MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL invitations waiting, to anything, which inviting enforces. */
export const listInvitations = query({
  args: {},
  returns: paginationResultValidator(pendingInvitationValidator),
  handler: async (ctx) => ({ page: await pendingInvitations(ctx), isDone: true, continueCursor: "" }),
});

/** Called only after Clerk confirms a verified address on the signed-in account. */
export const respondVerified = internalMutation({
  args: { ...actingArg, invitationId: v.id("itemInvitations"), emails: v.array(v.string()), accept: v.boolean() },
  returns: v.null(),
  handler: async (caller, { actingAs: as, ...args }) => {
    const ctx = await signedInAs(caller, as);
    const user = await getCurrentUser(ctx);
    if (!user) throw createError("UNAUTHENTICATED", "Sign in to respond");
    const invitation = await ctx.db.get("itemInvitations", args.invitationId);
    const library = invitation ? await libraryOf(ctx, invitation) : null;
    // One to anything else is answered where it was sent from (../sharing/invitations.ts).
    if (!invitation || invitation.kind !== "library" || !args.emails.includes(invitation.email)) throw createError("FORBIDDEN", "Sign in with the invited email address");
    // Accepting again what they accepted already, as a second press or a second tab does, changes nothing.
    if (args.accept && invitation.state === "accepted" && library && (await libraryGrant(ctx, library._id, user._id))) return null;
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) throw createError("CONFLICT", "Invitation expired or already answered");
    if (!library || library.state === "disabled" || !ownerActive(await libraryOwner(ctx, library))) throw createError("FORBIDDEN", "Library unavailable");
    // An outstanding invitation cannot overwrite a role granted since it was sent. Its place in the library becomes the person's.
    if (args.accept && !(await libraryGrant(ctx, library._id, user._id))) {
      await assertPersonHasRoom(ctx, user._id);
      await ctx.db.insert("itemAccess", { kind: "library", item: library._id, name: library.name, userId: user._id, role: grantedRole(invitation), grantedBy: invitation.invitedBy, grantedAt: Date.now() });
    }
    await ctx.db.patch("itemInvitations", invitation._id, { state: args.accept ? "accepted" : "declined" });
    return null;
  },
});
