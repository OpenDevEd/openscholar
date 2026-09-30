import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);

/**
 * Invitations saved before expiry was scheduled (#350): a pending one past its time is
 * marked expired, and one still running gets its expiry scheduled. Safe to run again;
 * an extra expiry run does nothing.
 *
 *   npx convex run migrations/expireInvitations:run '{"dryRun": true}'
 *   npx convex run migrations/expireInvitations:run
 */
export const authorProfileInvitations = migrations.define({
  table: "authorProfileInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.state !== "pending") return;
    if (invitation.expiresAt <= Date.now()) return { state: "expired" as const };
    await ctx.scheduler.runAt(invitation.expiresAt, internal.authors.invitations.expire, { invitationId: invitation._id });
  },
});

export const evidenceLibraryInvitations = migrations.define({
  table: "evidenceLibraryInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.state !== "pending") return;
    if (invitation.expiresAt <= Date.now()) return { state: "expired" as const };
    await ctx.scheduler.runAt(invitation.expiresAt, internal.evidenceLibraries.invitations.expire, { invitationId: invitation._id });
  },
});

export const run = migrations.runner([
  internal.migrations.expireInvitations.authorProfileInvitations,
  internal.migrations.expireInvitations.evidenceLibraryInvitations,
]);
