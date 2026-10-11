import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { MAX_ACCOUNTS_PER_EMAIL } from "../lib/queryBounds";
import { grantOf } from "../sharing/items";
import { invitationTo } from "../sharing/access";

/**
 * Moves author profiles' editors and their waiting invitations onto the tables every shared item
 * uses (#653): an editor becomes a guest who edits, and an invitation an item's, with the seven
 * days it had. A profile in no workspace has no guests, so its rows stay behind, and so does an
 * invitation to someone who edits it already, which would hold a second place for them. Safe to
 * run again: a place or an invitation already there is left as it is.
 *
 *   npx convex run migrations/authorAccess:run
 *   npx convex run migrations/authorAccess:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const members = migrations.define({
  table: "authorProfileMembers",
  migrateOne: async (ctx, member) => {
    const profile = await ctx.db.get("authorProfiles", member.profileId);
    // A deleted account's place would count against the profile's guests with nobody to show for it. A suspended one keeps its place for when it's back.
    const person = await ctx.db.get("users", member.userId);
    if (!profile?.workspaceId || !person || person.state === "deleted" || (await grantOf(ctx, profile._id, member.userId))) return;
    await ctx.db.insert("itemAccess", { kind: "author", item: profile._id, name: profile.name, userId: member.userId, role: "editor", grantedBy: profile.createdBy ?? member.userId, grantedAt: member._creationTime });
  },
});

export const invitations = migrations.define({
  table: "authorProfileInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return;
    const profile = await ctx.db.get("authorProfiles", invitation.profileId);
    if (!profile?.workspaceId || (await invitationTo(ctx, profile._id, invitation.email))) return;
    // Invited again while they already edit it: they have their place.
    const accounts = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", invitation.email)).take(MAX_ACCOUNTS_PER_EMAIL);
    for (const account of accounts) if (await grantOf(ctx, profile._id, account._id)) return;
    const invitationId = await ctx.db.insert("itemInvitations", { kind: "author", item: profile._id, email: invitation.email, role: "editor", invitedBy: invitation.invitedBy, expiresAt: invitation.expiresAt, state: "pending", delivery: invitation.delivery });
    await ctx.scheduler.runAt(invitation.expiresAt, internal.sharing.invitations.expire, { invitationId });
  },
});

export const run = migrations.runner([internal.migrations.authorAccess.members, internal.migrations.authorAccess.invitations]);

/** How many of the two moves haven't run to the end of their table; 0 when both have. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => (await migrations.getStatus(ctx, { migrations: [internal.migrations.authorAccess.members, internal.migrations.authorAccess.invitations] })).filter((status) => !status.isDone).length,
});
