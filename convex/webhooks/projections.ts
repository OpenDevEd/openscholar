import { internalMutation, type MutationCtx } from "../_generated/server";
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
          .collect();
        for (const activeMembership of activeMemberships) {
          if (activeMembership.clerkMembershipId !== args.membership.clerkMembershipId) {
            await ctx.db.patch("organizationMemberships", activeMembership._id, {
              state: "revoked",
              updatedAt: args.processedAt,
            });
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
