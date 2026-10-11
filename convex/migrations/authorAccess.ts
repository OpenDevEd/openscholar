import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { grantOf } from "../sharing/items";
import { invitationTo } from "../sharing/access";

/**
 * Moves author profiles' editors and their waiting invitations onto the tables every shared item
 * uses (#653): an editor becomes a guest who edits, and an invitation an item's, with the seven
 * days it had. A profile in no workspace has no guests, so its rows stay behind. Safe to run
 * again: a place or an invitation already there is left as it is.
 *
 *   npx convex run migrations/authorAccess:run
 *   npx convex run migrations/authorAccess:left
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const members = migrations.define({
  table: "authorProfileMembers",
  migrateOne: async (ctx, member) => {
    const profile = await ctx.db.get("authorProfiles", member.profileId);
    if (!profile?.workspaceId || !(await ctx.db.get("users", member.userId)) || (await grantOf(ctx, profile._id, member.userId))) return;
    await ctx.db.insert("itemAccess", { kind: "author", item: profile._id, name: profile.name, userId: member.userId, role: "editor", grantedBy: profile.createdBy ?? member.userId, grantedAt: member._creationTime });
  },
});

export const invitations = migrations.define({
  table: "authorProfileInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return;
    const profile = await ctx.db.get("authorProfiles", invitation.profileId);
    if (!profile?.workspaceId || (await invitationTo(ctx, profile._id, invitation.email))) return;
    const invitationId = await ctx.db.insert("itemInvitations", { kind: "author", item: profile._id, email: invitation.email, role: "editor", invitedBy: invitation.invitedBy, expiresAt: invitation.expiresAt, state: "pending", delivery: invitation.delivery });
    await ctx.scheduler.runAt(invitation.expiresAt, internal.sharing.invitations.expire, { invitationId });
  },
});

export const run = migrations.runner([internal.migrations.authorAccess.members, internal.migrations.authorAccess.invitations]);

/** Old rows one check reads of each table: shared dev holds none of either, and 3 that are answered. */
const CHECKED = 1000;

/** How many editors and waiting invitations aren't on the shared tables yet, among the first CHECKED rows of each old table; 0 when done. */
export const left = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let missing = 0;
    for (const member of await ctx.db.query("authorProfileMembers").take(CHECKED)) {
      const profile = await ctx.db.get("authorProfiles", member.profileId);
      if (profile?.workspaceId && (await ctx.db.get("users", member.userId)) && !(await grantOf(ctx, profile._id, member.userId))) missing++;
    }
    for (const invitation of await ctx.db.query("authorProfileInvitations").take(CHECKED)) {
      if (invitation.state !== "pending") continue;
      const profile = await ctx.db.get("authorProfiles", invitation.profileId);
      if (profile?.workspaceId && !(await invitationTo(ctx, profile._id, invitation.email))) missing++;
    }
    return missing;
  },
});
