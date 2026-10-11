import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL, SINGLE_ROW_CLEANUP } from "../lib/queryBounds";
import { libraryOf } from "../evidenceLibraries/access";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { endWhatsLeft } from "../billing/seatSyncs";
import { v } from "convex/values";
import {
  clerkEventOutcomeValidator,
  clerkInvitationSnapshotFields,
  clerkMembershipSnapshotFields,
  clerkOrganizationSnapshotFields,
} from "../evidenceLibraries/validators";
import type {
  ClerkInvitationSnapshot,
  ClerkMembershipSnapshot,
  ClerkOrganizationSnapshot,
} from "./clerk_mappers";
import {
  applyOrderedClerkEvent,
  type ClerkEventMetadata,
  type ClerkEventOutcome,
} from "./eventOrdering";

/** Memberships of a deleted organization one mutation revokes. */
export const MEMBERSHIP_REVOKE_BATCH = 500;

type ProjectionMetadata = Omit<ClerkEventMetadata, "entityType">;
type MembershipProjectionMetadata = Omit<ProjectionMetadata, "entityId">;

const eventMetadataFields = {
  eventId: v.string(),
  eventType: v.string(),
  instanceId: v.string(),
  occurredAt: v.number(),
  payloadSha256: v.string(),
};

async function upsertOrganizationSnapshot(
  ctx: MutationCtx,
  snapshot: ClerkOrganizationSnapshot,
  processedAt: number,
  reactivateDeleted: boolean,
  acceptEqualTimestamp: boolean,
) {
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_clerkOrganizationId", (query) =>
      query.eq("clerkOrganizationId", snapshot.clerkOrganizationId),
    )
    .unique();
  if (!existing) {
    const organizationId = await ctx.db.insert("organizations", {
      ...snapshot,
      state: "active",
      createdAt: processedAt,
      updatedAt: processedAt,
    });
    const workspaceId = await ensureWorkspace(ctx, { kind: "organization", organizationId });
    // Its own Autumn customer, on the free organization plan (#650).
    await ctx.scheduler.runAfter(0, internal.billing.accounts.provisionOrganization, { workspaceId });
    return organizationId;
  }
  if (
    snapshot.clerkUpdatedAt < existing.clerkUpdatedAt ||
    (!acceptEqualTimestamp &&
      snapshot.clerkUpdatedAt === existing.clerkUpdatedAt) ||
    (existing.state === "deleted" && !reactivateDeleted)
  ) {
    return existing._id;
  }
  await ctx.db.patch("organizations", existing._id, {
    ...snapshot,
    state: "active",
    updatedAt: processedAt,
  });
  return existing._id;
}

/**
 * Removes one page of a person's library grants in an organization they've left, and
 * schedules the next until every grant made up to `before`, their newest when they left, has been
 * looked at: no grant outlives the membership, however many the person holds.
 */
async function revokeGrantsPage(ctx: MutationCtx, clerkUserId: string, organizationId: Id<"organizations">, cursor: string | null, before: number) {
  const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkUserId)).unique();
  if (!user) return;
  // Their roles in libraries are rows of the table every shared item's guests are in (../evidenceLibraries/access.ts).
  const page = await ctx.db.query("itemAccess")
    .withIndex("by_user_and_kind_and_grantedAt", q => q.eq("userId", user._id).eq("kind", "library"))
    .paginate({ cursor, numItems: MAX_LIBRARY_GRANTS_PER_PERSON });
  // A purged organization's workspace held no library (deleting one with a library is refused), so there's nothing to revoke.
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique();
  if (!workspace) return;
  for (const assignment of page.page) {
    // A grant made since they left, by a later invitation, is theirs to keep.
    if (assignment.grantedAt > before) continue;
    if ((await libraryOf(ctx, assignment))?.workspaceId === workspace._id) await ctx.db.delete("itemAccess", assignment._id);
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.webhooks.projections.revokeGrants, { clerkUserId, organizationId, cursor: page.continueCursor, before });
}

/**
 * Revokes one page of a deleted organization's memberships and schedules the next until none
 * is active, so they stop counting against the organizations a person can belong to.
 */
async function revokeMembershipsPage(ctx: MutationCtx, organizationId: Id<"organizations">) {
  // A later batch stops if a newer organization event has since made it active again.
  if ((await ctx.db.get("organizations", organizationId))?.state !== "deleted") return;
  const active = await ctx.db.query("organizationMemberships")
    .withIndex("by_organizationId_and_state", q => q.eq("organizationId", organizationId).eq("state", "active"))
    .take(MEMBERSHIP_REVOKE_BATCH);
  for (const membership of active) await ctx.db.patch("organizationMemberships", membership._id, { state: "revoked", updatedAt: Date.now() });
  if (active.length === MEMBERSHIP_REVOKE_BATCH) await ctx.scheduler.runAfter(0, internal.webhooks.projections.revokeMemberships, { organizationId });
}

export const revokeMemberships = internalMutation({
  args: { organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, { organizationId }) => {
    await revokeMembershipsPage(ctx, organizationId);
    return null;
  },
});

export const revokeGrants = internalMutation({
  args: { clerkUserId: v.string(), organizationId: v.id("organizations"), cursor: v.string(), before: v.number() },
  returns: v.null(),
  handler: async (ctx, { clerkUserId, organizationId, cursor, before }) => {
    await revokeGrantsPage(ctx, clerkUserId, organizationId, cursor, before);
    return null;
  },
});

export async function applyOrganizationProjection(
  ctx: MutationCtx,
  args: ProjectionMetadata &
    (
      | {
          action: "upsert";
          organization: ClerkOrganizationSnapshot;
        }
      | { action: "delete" }
    ),
): Promise<ClerkEventOutcome> {
  return await applyOrderedClerkEvent(
    ctx,
    { ...args, entityType: "organization" },
    async () => {
      if (args.action === "upsert") {
        await upsertOrganizationSnapshot(
          ctx,
          args.organization,
          args.processedAt,
          true,
          true,
        );
        return;
      }
      const existing = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", args.entityId),
        )
        .unique();
      if (existing) {
        await ctx.db.patch("organizations", existing._id, {
          state: "deleted",
          updatedAt: args.processedAt,
        });
        await revokeMembershipsPage(ctx, existing._id);
        // Its workspace and everything in it go (#651), and whatever of Team it held in Autumn ends (#652).
        await ctx.scheduler.runAfter(0, internal.workspaces.purge.purgeOrganization, { organizationId: existing._id });
        const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", existing._id)).unique();
        if (workspace) await endWhatsLeft(ctx, workspace._id);
      }
    },
  );
}

export async function applyMembershipProjection(
  ctx: MutationCtx,
  args: MembershipProjectionMetadata & {
    action: "upsert" | "delete";
    membership: ClerkMembershipSnapshot;
  },
): Promise<ClerkEventOutcome> {
  if (
    (args.action === "upsert" && args.membership.state !== "active") ||
    (args.action === "delete" && args.membership.state !== "revoked")
  ) {
    throw new Error("Membership action and state do not match");
  }

  return await applyOrderedClerkEvent(
    ctx,
    {
      ...args,
      entityType: "organizationMembership",
      entityId: JSON.stringify([
        args.membership.organization.clerkOrganizationId,
        args.membership.clerkUserId,
      ]),
    },
    async () => {
      const organizationId = await upsertOrganizationSnapshot(
        ctx,
        args.membership.organization,
        args.processedAt,
        false,
        false,
      );
      const existing = await ctx.db
        .query("organizationMemberships")
        .withIndex("by_clerkMembershipId", (query) =>
          query.eq("clerkMembershipId", args.membership.clerkMembershipId),
        )
        .unique();
      if (args.membership.state === "active") {
        const activeMemberships = await ctx.db
          .query("organizationMemberships")
          .withIndex(
            "by_organizationId_and_clerkUserId_and_state",
            (query) =>
              query
                .eq("organizationId", organizationId)
                .eq("clerkUserId", args.membership.clerkUserId)
                .eq("state", "active"),
          )
          // Each activation revokes the others it finds, so one stays active.
          .take(SINGLE_ROW_CLEANUP);
        for (const activeMembership of activeMemberships) {
          if (activeMembership.clerkMembershipId !== args.membership.clerkMembershipId) {
            await ctx.db.patch("organizationMemberships", activeMembership._id, {
              state: "revoked",
              updatedAt: args.processedAt,
            });
          }
        }
        // A member has no invitation to answer. Clerk's own event saying so can come later than
        // the membership, so the seat it held frees now; a late event from before can't reopen it.
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", args.membership.clerkUserId)).unique();
        if (user) {
          const answered = await ctx.db.query("organizationInvitations")
            .withIndex("by_email_and_state", (q) => q.eq("email", user.email.toLowerCase()).eq("state", "pending"))
            .filter((q) => q.eq(q.field("organizationId"), organizationId))
            .take(SINGLE_ROW_CLEANUP);
          for (const invitation of answered) {
            await ctx.db.patch("organizationInvitations", invitation._id, { state: "accepted", clerkUpdatedAt: Math.max(invitation.clerkUpdatedAt, args.membership.clerkCreatedAt), updatedAt: args.processedAt });
          }
        }
      }
      if (args.membership.state === "revoked") {
        // The sweep takes the grants up to the newest they hold now, by when each was given: the
        // event's own clock can't draw that line, and one given after they left is later than it.
        const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", args.membership.clerkUserId)).unique();
        const newest = user ? await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", q => q.eq("userId", user._id).eq("kind", "library")).order("desc").first() : null;
        if (newest) await revokeGrantsPage(ctx, args.membership.clerkUserId, organizationId, null, newest.grantedAt);
        // Read, not made: a deleted organization's workspace is purged, and a late event mustn't bring it back.
        const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique();
        if (user && workspace) {
          const invitations = await ctx.db.query("itemInvitations")
            .withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);
          for (const invitation of invitations) {
            if ((await libraryOf(ctx, invitation))?.workspaceId === workspace._id) await ctx.db.patch("itemInvitations", invitation._id, { state: "cancelled" });
          }
        }
      }
      // A deleted organization has no members: an event that arrives late can't make one.
      const gone = (await ctx.db.get("organizations", organizationId))?.state === "deleted";
      const membershipFields = {
        organizationId,
        clerkMembershipId: args.membership.clerkMembershipId,
        clerkUserId: args.membership.clerkUserId,
        role: args.membership.role,
        state: gone ? "revoked" as const : args.membership.state,
        clerkCreatedAt: args.membership.clerkCreatedAt,
        clerkUpdatedAt: args.membership.clerkUpdatedAt,
        updatedAt: args.processedAt,
      };
      if (existing) {
        await ctx.db.patch("organizationMemberships", existing._id, membershipFields);
      } else {
        await ctx.db.insert("organizationMemberships", {
          ...membershipFields,
          createdAt: args.processedAt,
        });
      }
      // On the Team plan, a member who joins gets a seat and one who leaves gives theirs up (#652).
      const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
      const account = workspace && await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).unique();
      if (workspace && account?.plan === TEAM_PLAN) await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId: workspace._id });
    },
  );
}

/**
 * Keeps an invitation to an organization as Clerk has it (#651): sent, accepted, revoked or
 * expired. One for an organization not projected yet waits for Clerk to send it again.
 */
export async function applyInvitationProjection(
  ctx: MutationCtx,
  args: MembershipProjectionMetadata & { invitation: ClerkInvitationSnapshot },
): Promise<ClerkEventOutcome> {
  return await applyOrderedClerkEvent(
    ctx,
    { ...args, entityType: "organizationInvitation", entityId: args.invitation.clerkInvitationId },
    async () => {
      const { clerkOrganizationId, ...invitation } = args.invitation;
      const organization = await ctx.db.query("organizations").withIndex("by_clerkOrganizationId", (q) => q.eq("clerkOrganizationId", clerkOrganizationId)).unique();
      if (!organization) throw new Error("Invitation to an organization not projected yet");
      const existing = await ctx.db.query("organizationInvitations").withIndex("by_clerkInvitationId", (q) => q.eq("clerkInvitationId", invitation.clerkInvitationId)).unique();
      if (!existing) {
        const invitationId = await ctx.db.insert("organizationInvitations", { ...invitation, organizationId: organization._id, createdAt: args.processedAt, updatedAt: args.processedAt });
        // Clerk sends nothing when its link expires.
        if (invitation.state === "pending" && invitation.expiresAt) await ctx.scheduler.runAt(invitation.expiresAt, internal.organizations.read.expireInvitation, { invitationId });
      } else if (invitation.clerkUpdatedAt >= existing.clerkUpdatedAt) {
        await ctx.db.patch("organizationInvitations", existing._id, { ...invitation, updatedAt: args.processedAt });
      }
    },
  );
}

export const applyOrganizationInvitationEvent = internalMutation({
  args: { ...eventMetadataFields, invitation: v.object(clerkInvitationSnapshotFields) },
  returns: clerkEventOutcomeValidator,
  handler: async (ctx, args) => await applyInvitationProjection(ctx, { ...args, processedAt: Date.now() }),
});

export const applyOrganizationEvent = internalMutation({
  args: {
    ...eventMetadataFields,
    action: v.union(v.literal("upsert"), v.literal("delete")),
    entityId: v.string(),
    organization: v.optional(v.object(clerkOrganizationSnapshotFields)),
  },
  returns: clerkEventOutcomeValidator,
  handler: async (ctx, args) => {
    const common = {
      eventId: args.eventId,
      eventType: args.eventType,
      instanceId: args.instanceId,
      occurredAt: args.occurredAt,
      payloadSha256: args.payloadSha256,
      processedAt: Date.now(),
      entityId: args.entityId,
    };
    if (args.action === "upsert") {
      if (!args.organization) {
        throw new Error("Organization upsert requires a snapshot");
      }
      return await applyOrganizationProjection(ctx, {
        ...common,
        action: "upsert",
        organization: args.organization,
      });
    }
    if (args.organization) {
      throw new Error("Organization delete must not include a snapshot");
    }
    return await applyOrganizationProjection(ctx, {
      ...common,
      action: "delete",
    });
  },
});

export const applyOrganizationMembershipEvent = internalMutation({
  args: {
    ...eventMetadataFields,
    action: v.union(v.literal("upsert"), v.literal("delete")),
    membership: v.object(clerkMembershipSnapshotFields),
  },
  returns: clerkEventOutcomeValidator,
  handler: async (ctx, args) =>
    await applyMembershipProjection(ctx, {
      ...args,
      processedAt: Date.now(),
    }),
});
