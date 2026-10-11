import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, type QueryCtx } from "../_generated/server";
import { libraryGrant } from "../evidenceLibraries/access";
import { internalMutation } from "../lib/functions";
import { invitationTo } from "../sharing/access";

/**
 * Moves each Evidence Library's editors and creators, and its waiting invitations, onto the tables
 * every shared item's guests are in (#653), with the role each had and when it was given. A
 * library's owners have no row: they are its organization's admins. A grant to an account that's
 * deleted or was never made stays behind, as does an invitation that's answered, cancelled or
 * past its time. Safe to run again: a role or an invitation already there is left as it is.
 *
 *   npx convex run migrations/libraryAccess:run
 *   npx convex run migrations/libraryAccess:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const account = (ctx: Pick<QueryCtx, "db">, clerkId: string) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();

export const members = migrations.define({
  table: "evidenceLibraryMembers",
  migrateOne: async (ctx, member) => {
    const [library, person] = await Promise.all([ctx.db.get("evidenceLibraries", member.libraryId), account(ctx, member.clerkUserId)]);
    // A deleted account's row would hold a place in the library with nobody to show for it. A suspended one keeps its role for when it's back.
    if (!library || !person || person.state === "deleted" || (await libraryGrant(ctx, library._id, person._id))) return;
    const by = (await account(ctx, member.grantedBy)) ?? person;
    await ctx.db.insert("itemAccess", { kind: "library", item: library._id, name: library.name, userId: person._id, role: member.role, grantedBy: by._id, grantedAt: member.grantedAt });
  },
});

export const invitations = migrations.define({
  table: "evidenceLibraryInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return;
    const [library, by] = await Promise.all([ctx.db.get("evidenceLibraries", invitation.libraryId), account(ctx, invitation.invitedBy)]);
    // Whoever sent it is named on the row; one whose sender's account is gone can be sent again.
    if (!library || !by || (await invitationTo(ctx, library._id, invitation.email))) return;
    const invitationId = await ctx.db.insert("itemInvitations", { kind: "library", item: library._id, email: invitation.email, role: invitation.role, invitedBy: by._id, expiresAt: invitation.expiresAt, state: "pending", delivery: invitation.delivery });
    await ctx.scheduler.runAt(invitation.expiresAt, internal.sharing.invitations.expire, { invitationId });
  },
});

export const run = migrations.runner([internal.migrations.libraryAccess.members, internal.migrations.libraryAccess.invitations]);

/** How many of the two moves haven't run to the end of their table; 0 when both have. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => (await migrations.getStatus(ctx, { migrations: [internal.migrations.libraryAccess.members, internal.migrations.libraryAccess.invitations] })).filter((status) => !status.isDone).length,
});
