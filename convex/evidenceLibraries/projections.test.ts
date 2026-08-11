/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";

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
});
