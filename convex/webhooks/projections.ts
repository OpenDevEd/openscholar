import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_PENDING_INVITATIONS_PER_EMAIL, SINGLE_ROW_CLEANUP } from "../lib/queryBounds";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { existingBefore } from "../lib/cutoff";
import { v } from "convex/values";
import {
  clerkEventOutcomeValidator,
  clerkMembershipSnapshotFields,
  clerkOrganizationSnapshotFields,
} from "../evidenceLibraries/validators";
import type {
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
    return await ctx.db.insert("organizations", {
      ...snapshot,
      state: "active",
      createdAt: processedAt,
      updatedAt: processedAt,
    });
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
 * schedules the next until every grant they held at `before`, when they left, has been
 * looked at: no grant outlives the membership, however many the person holds.
 */
async function revokeGrantsPage(ctx: MutationCtx, clerkUserId: string, organizationId: Id<"organizations">, cursor: string | null, before: number) {
  const page = await ctx.db.query("evidenceLibraryMembers")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .paginate({ cursor, numItems: MAX_LIBRARY_GRANTS_PER_PERSON });
  for (const assignment of page.page) {
    // A grant made since they left, by a later invitation, is theirs to keep.
    if (assignment._creationTime >= before) continue;
    const library = await ctx.db.get("evidenceLibraries", assignment.libraryId);
    if (library?.organizationId === organizationId) {
      await ctx.db.delete("evidenceLibraryMembers", assignment._id);
    }
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.webhooks.projections.revokeGrants, { clerkUserId, organizationId, cursor: page.continueCursor, before });
}

/**
 * Revokes one page of a deleted organization's memberships and schedules the next until none
 * is active, so they stop counting against the organizations a person can belong to.
 */
async function revokeMembershipsPage(ctx: MutationCtx, organizationId: Id<"organizations">) {
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
      }
      if (args.membership.state === "revoked") {
        await revokeGrantsPage(ctx, args.membership.clerkUserId, organizationId, null, existingBefore());
        const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", args.membership.clerkUserId)).unique();
        if (user) {
          const invitations = await ctx.db.query("evidenceLibraryInvitations")
            .withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_EMAIL);
          for (const invitation of invitations) {
            const library = await ctx.db.get("evidenceLibraries", invitation.libraryId);
            if (library?.organizationId === organizationId) await ctx.db.patch("evidenceLibraryInvitations", invitation._id, { state: "cancelled" });
          }
        }
      }
      const membershipFields = {
        organizationId,
        clerkMembershipId: args.membership.clerkMembershipId,
        clerkUserId: args.membership.clerkUserId,
        role: args.membership.role,
        state: args.membership.state,
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
    },
  );
}

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
