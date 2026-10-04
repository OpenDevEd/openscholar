/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  applyMembershipProjection,
  applyOrganizationProjection,
} from "../webhooks/projections";
import { readMemberOrganizations } from "../organizationFeatures";
import { seedFeatureUser } from "../organizationFeatures.test-support";

const organizationSnapshot = {
  clerkOrganizationId: "org_123",
  name: "Evidence Team",
  slug: "evidence-team",
  imageUrl: "https://img.example/org.png",
  evidenceLibrariesEnabled: false,
  authorsEnabled: false,
  extractionEnabled: false,
  clerkCreatedAt: 1_700_000_000_000,
  clerkUpdatedAt: 1_700_000_001_000,
};

function eventMetadata(eventId: string, occurredAt: number) {
  return {
    eventId,
    eventType: "organization.updated",
    instanceId: "ins_123",
    occurredAt,
    payloadSha256: eventId.padEnd(64, "a"),
    processedAt: occurredAt * 1_000,
  };
}

describe("Evidence Library identity projections", () => {
  it("stores organization, membership, and Clerk event identity separately", async () => {
    const t = convexTest(schema);

    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_123",
        name: "Evidence Team",
        slug: "evidence-team",
        state: "active",
        evidenceLibrariesEnabled: false,
        clerkCreatedAt: 1_700_000_000_000,
        clerkUpdatedAt: 1_700_000_001_000,
        createdAt: 1_700_000_002_000,
        updatedAt: 1_700_000_002_000,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_123",
        clerkUserId: "user_123",
        role: "org:admin",
        state: "active",
        clerkCreatedAt: 1_700_000_003_000,
        clerkUpdatedAt: 1_700_000_004_000,
        createdAt: 1_700_000_005_000,
        updatedAt: 1_700_000_005_000,
      });
      await ctx.db.insert("clerkEventLogs", {
        instanceId: "ins_123",
        eventId: "msg_123",
        eventType: "organizationMembership.created",
        entityType: "organizationMembership",
        entityId: "orgmem_123",
        occurredAt: 1_700_000_006,
        payloadSha256: "a".repeat(64),
        outcome: "applied",
        processedAt: 1_700_000_007_000,
      });

      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_123"),
        )
        .unique();
      const membershipRows = await ctx.db
        .query("organizationMemberships")
        .collect();
      const eventRows = await ctx.db.query("clerkEventLogs").collect();
      return { eventRows, membershipRows, organization };
    });

    expect(result.organization).toMatchObject({
      clerkOrganizationId: "org_123",
      state: "active",
    });
    expect(result.membershipRows).toHaveLength(1);
    expect(result.membershipRows[0]).toMatchObject({
      clerkUserId: "user_123",
      role: "org:admin",
      state: "active",
    });
    expect(result.eventRows).toHaveLength(1);
    expect(result.eventRows[0]).toMatchObject({
      eventId: "msg_123",
      outcome: "applied",
      payloadSha256: "a".repeat(64),
    });
  });

  it("applies an organization event once and rejects stale or tied events", async () => {
    const t = convexTest(schema);

    const first = await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_first", 100),
        action: "upsert",
        entityId: "org_123",
        organization: organizationSnapshot,
      }),
    );
    const replay = await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_first", 100),
        action: "upsert",
        entityId: "org_123",
        organization: { ...organizationSnapshot, name: "Replay must not apply" },
      }),
    );
    const tied = await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_a_tied", 100),
        action: "upsert",
        entityId: "org_123",
        organization: { ...organizationSnapshot, name: "Tie must not apply" },
      }),
    );
    const stale = await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_stale", 99),
        action: "upsert",
        entityId: "org_123",
        organization: { ...organizationSnapshot, name: "Stale must not apply" },
      }),
    );
    const stored = await t.run((ctx) =>
      ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_123"),
        )
        .unique(),
    );

    expect([first, replay, tied, stale]).toEqual([
      "applied",
      "duplicate",
      "timestamp_conflict",
      "stale",
    ]);
    expect(stored).toMatchObject({ name: "Evidence Team", state: "active" });
  });

  it("converges on the same equal-timestamp winner in either delivery order", async () => {
    async function run(order: readonly ["msg_a", "msg_z"] | readonly ["msg_z", "msg_a"]) {
      const t = convexTest(schema);
      for (const eventId of order) {
        await t.run((ctx) =>
          applyOrganizationProjection(ctx, {
            ...eventMetadata(eventId, 100),
            action: "upsert",
            entityId: "org_123",
            organization: {
              ...organizationSnapshot,
              name: eventId === "msg_z" ? "Deterministic winner" : "Tie loser",
            },
          }),
        );
      }
      return await t.run(async (ctx) => {
        const organization = await ctx.db
          .query("organizations")
          .withIndex("by_clerkOrganizationId", (query) =>
            query.eq("clerkOrganizationId", "org_123"),
          )
          .unique();
        const logs = await ctx.db.query("clerkEventLogs").collect();
        return {
          name: organization?.name,
          outcomes: Object.fromEntries(
            logs.map((log) => [log.eventId, log.outcome]).sort(),
          ),
        };
      });
    }

    const expected = {
      name: "Deterministic winner",
      outcomes: { msg_a: "timestamp_conflict", msg_z: "applied" },
    };
    expect(await run(["msg_a", "msg_z"])).toEqual(expected);
    expect(await run(["msg_z", "msg_a"])).toEqual(expected);
  });

  it("fails closed when a signed event ID is reused with different content", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_reused", 100),
        action: "upsert",
        entityId: "org_123",
        organization: organizationSnapshot,
      }),
    );

    await expect(
      t.run((ctx) =>
        applyOrganizationProjection(ctx, {
          ...eventMetadata("msg_reused", 100),
          payloadSha256: "f".repeat(64),
          action: "upsert",
          entityId: "org_123",
          organization: { ...organizationSnapshot, name: "Tampered replay" },
        }),
      ),
    ).rejects.toThrow(/reused with different signed content/);
  });

  it("tombstones an organization and prevents stale resurrection", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_create", 100),
        action: "upsert",
        entityId: "org_123",
        organization: organizationSnapshot,
      }),
    );
    await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_delete", 102),
        action: "delete",
        entityId: "org_123",
      }),
    );
    const outcome = await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_delayed_update", 101),
        action: "upsert",
        entityId: "org_123",
        organization: { ...organizationSnapshot, name: "Resurrected" },
      }),
    );
    const stored = await t.run((ctx) =>
      ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_123"),
        )
        .unique(),
    );

    expect(outcome).toBe("stale");
    expect(stored).toMatchObject({ name: "Evidence Team", state: "deleted" });
  });

  it("keeps a newer Evidence Libraries switch when a stale membership event arrives", async () => {
    const t = convexTest(schema);

    // Clerk switches the organisation on.
    await t.run((ctx) =>
      applyOrganizationProjection(ctx, {
        ...eventMetadata("msg_switch_on", 100),
        action: "upsert",
        entityId: "org_123",
        organization: {
          ...organizationSnapshot,
          evidenceLibrariesEnabled: true,
          clerkUpdatedAt: 1_700_000_010_000,
        },
      }),
    );

    // A membership event that Clerk built before the switch arrives late. Its
    // organisation snapshot still says off, and it must not win.
    await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_stale_membership", 101),
        eventType: "organizationMembership.created",
        action: "upsert",
        membership: {
          clerkCreatedAt: 1_700_000_002_000,
          clerkMembershipId: "orgmem_stale",
          clerkUpdatedAt: 1_700_000_003_000,
          clerkUserId: "user_123",
          organization: {
            ...organizationSnapshot,
            evidenceLibrariesEnabled: false,
            clerkUpdatedAt: 1_700_000_009_000,
          },
          role: "org:member",
          state: "active",
        },
      }),
    );

    const stored = await t.run((ctx) =>
      ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_123"),
        )
        .unique(),
    );
    expect(stored).toMatchObject({ evidenceLibrariesEnabled: true });
  });

  it("removes library grants and pending invitations only under the revoked organization", async () => {
    // One frozen millisecond: the grants are made in the millisecond the person leaves, and still go.
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const t = convexTest(schema);
    const ids = await t.run(async ctx => {
      await ctx.db.insert("users", {libraryItemCount: 0,  clerkId: "user_123", email: "person@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      const organizationId = await ctx.db.insert("organizations", { ...organizationSnapshot, state: "active", createdAt: 1, updatedAt: 1 });
      const otherOrganizationId = await ctx.db.insert("organizations", { ...organizationSnapshot, clerkOrganizationId: "other_org", slug: "other", state: "active", createdAt: 1, updatedAt: 1 });
      const libraryIds: Id<"evidenceLibraries">[] = [];
      for (const org of [organizationId, organizationId, otherOrganizationId]) {
        const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId: org, name: "Library", slug: `library-${libraryIds.length}`, state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
        libraryIds.push(libraryId);
        await ctx.db.insert("evidenceLibraryMembers", { libraryId, clerkUserId: "user_123", role: "editor", grantedBy: "owner", grantedAt: 1 });
        await ctx.db.insert("evidenceLibraryInvitations", { libraryId, email: "person@example.org", role: "creator", invitedBy: "owner", expiresAt: Date.now() + 100000, state: "pending", delivery: "sent" });
      }
      return libraryIds;
    });
    await t.run(ctx => applyMembershipProjection(ctx, {
      ...eventMetadata("remove_member_grants", 200), eventType: "organizationMembership.deleted", action: "delete",
      membership: { organization: organizationSnapshot, clerkMembershipId: "orgmem_removed", clerkUserId: "user_123", role: "org:member", state: "revoked", clerkCreatedAt: 1, clerkUpdatedAt: 2 },
    }));
    expect(await t.run(ctx => ctx.db.query("evidenceLibraryMembers").collect())).toEqual([expect.objectContaining({ libraryId: ids[2] })]);
    const pending = await t.run(ctx => ctx.db.query("evidenceLibraryInvitations").withIndex("by_email_and_state", q => q.eq("email", "person@example.org").eq("state", "pending")).collect());
    expect(pending).toEqual([expect.objectContaining({ libraryId: ids[2] })]);
  });

  it("keeps a deleted organization's membership revoked when an earlier membership event arrives late (#427)", async () => {
    const t = convexTest(schema);
    const membership = { clerkCreatedAt: 1, clerkMembershipId: "orgmem_late", clerkUpdatedAt: 2, clerkUserId: "user_late", organization: organizationSnapshot, role: "org:member" as const, state: "active" as const };
    const event = (eventId: string, occurredAt: number) => t.run((ctx) => applyMembershipProjection(ctx, { ...eventMetadata(eventId, occurredAt), eventType: "organizationMembership.updated", action: "upsert", membership }));
    await event("msg_joined", 100);
    await t.run((ctx) => applyOrganizationProjection(ctx, { ...eventMetadata("msg_org_gone", 300), action: "delete", entityId: organizationSnapshot.clerkOrganizationId }));
    await event("msg_late_update", 200);
    expect(await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_clerkMembershipId", (q) => q.eq("clerkMembershipId", "orgmem_late")).unique())).toMatchObject({ state: "revoked" });
  });

  it("projects a membership and its organization atomically", async () => {
    const t = convexTest(schema);
    const membership = {
      clerkCreatedAt: 1_700_000_002_000,
      clerkMembershipId: "orgmem_123",
      clerkUpdatedAt: 1_700_000_003_000,
      clerkUserId: "user_123",
      organization: organizationSnapshot,
      role: "org:member" as const,
      state: "active" as const,
    };

    const created = await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_membership_create", 100),
        eventType: "organizationMembership.created",
        action: "upsert",
        membership,
      }),
    );
    const revoked = await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_membership_delete", 102),
        eventType: "organizationMembership.deleted",
        action: "delete",
        membership: { ...membership, state: "revoked" },
      }),
    );
    const delayed = await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_membership_delayed", 101),
        eventType: "organizationMembership.updated",
        action: "upsert",
        membership: { ...membership, role: "org:admin" },
      }),
    );
    const stored = await t.run(async (ctx) => ({
      membership: await ctx.db
        .query("organizationMemberships")
        .withIndex("by_clerkMembershipId", (query) =>
          query.eq("clerkMembershipId", "orgmem_123"),
        )
        .unique(),
      organization: await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_123"),
        )
        .unique(),
    }));

    expect([created, revoked, delayed]).toEqual(["applied", "applied", "stale"]);
    expect(stored.organization).toMatchObject({ state: "active" });
    expect(stored.membership).toMatchObject({
      role: "org:member",
      state: "revoked",
    });
  });

  it("authorizes a rejoin and converges across tied delete/create delivery order", async () => {
    async function run(
      order: readonly ["delete", "create"] | readonly ["create", "delete"],
    ) {
      const t = convexTest(schema);
      const oldMembership = {
        clerkCreatedAt: 1_700_000_002_000,
        clerkMembershipId: "orgmem_old",
        clerkUpdatedAt: 1_700_000_003_000,
        clerkUserId: "user_rejoin",
        organization: organizationSnapshot,
        role: "org:member" as const,
        state: "active" as const,
      };
      const newMembership = {
        ...oldMembership,
        clerkMembershipId: "orgmem_new",
        clerkUpdatedAt: 1_700_000_004_000,
      };
      await t.run((ctx) =>
        applyMembershipProjection(ctx, {
          ...eventMetadata("msg_initial", 90),
          eventType: "organizationMembership.created",
          action: "upsert",
          membership: oldMembership,
        }),
      );
      for (const action of order) {
        await t.run((ctx) =>
          applyMembershipProjection(
            ctx,
            action === "create"
              ? {
                  ...eventMetadata("msg_z_create", 100),
                  eventType: "organizationMembership.created",
                  action: "upsert",
                  membership: newMembership,
                }
              : {
                  ...eventMetadata("msg_a_delete", 100),
                  eventType: "organizationMembership.deleted",
                  action: "delete",
                  membership: { ...oldMembership, state: "revoked" },
                },
          ),
        );
      }
      const delayed = await t.run((ctx) =>
        applyMembershipProjection(ctx, {
          ...eventMetadata("msg_delayed_old", 99),
          eventType: "organizationMembership.updated",
          action: "upsert",
          membership: { ...oldMembership, role: "org:admin" },
        }),
      );
      const member = t.withIdentity({
        subject: "user_rejoin",
        o: { id: "org_123", rol: "org:member" },
      });
      return await member.run(async (ctx) => {
        await seedFeatureUser(ctx, "user_rejoin");
        const [access] = await readMemberOrganizations(ctx);
        if (!access) throw new Error("Active membership missing");
        const memberships = await ctx.db
          .query("organizationMemberships")
          .collect();
        return {
          authorizedMembershipId: access.membership.clerkMembershipId,
          delayed,
          memberships: memberships
            .map(({ clerkMembershipId, role, state }) => ({
              clerkMembershipId,
              role,
              state,
            }))
            .sort((left, right) =>
              left.clerkMembershipId.localeCompare(right.clerkMembershipId),
            ),
        };
      });
    }

    const expected = {
      authorizedMembershipId: "orgmem_new",
      delayed: "stale",
      memberships: [
        { clerkMembershipId: "orgmem_new", role: "org:member", state: "active" },
        { clerkMembershipId: "orgmem_old", role: "org:member", state: "revoked" },
      ],
    };
    expect(await run(["delete", "create"])).toEqual(expected);
    expect(await run(["create", "delete"])).toEqual(expected);
  });
});
