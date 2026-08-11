/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  applyMembershipProjection,
  applyOrganizationProjection,
} from "../webhooks/projections";

const organizationSnapshot = {
  clerkOrganizationId: "org_123",
  name: "Evidence Team",
  slug: "evidence-team",
  imageUrl: "https://img.example/org.png",
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
        ...eventMetadata("msg_tied", 100),
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
        entityId: "orgmem_123",
        membership,
      }),
    );
    const revoked = await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_membership_delete", 102),
        eventType: "organizationMembership.deleted",
        action: "delete",
        entityId: "orgmem_123",
        membership: { ...membership, state: "revoked" },
      }),
    );
    const delayed = await t.run((ctx) =>
      applyMembershipProjection(ctx, {
        ...eventMetadata("msg_membership_delayed", 101),
        eventType: "organizationMembership.updated",
        action: "upsert",
        entityId: "orgmem_123",
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
});
