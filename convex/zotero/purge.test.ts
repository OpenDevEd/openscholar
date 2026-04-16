import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

// --- Seed helpers ---

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides?: { email?: string; clerkId?: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: overrides?.clerkId ?? "clerk_purge_test",
      email: overrides?.email ?? "purge@test.com",
      firstName: "Purge",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    return userId;
  });
}

async function seedZoteroConnection(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides?: { zoteroUserId?: string },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("zoteroConnections", {
      userId,
      zoteroUserId: overrides?.zoteroUserId ?? "12345",
      encryptedApiKey: "enc_test",
      keyPrefix: "zk_test",
      username: "testuser",
      connectedAt: Date.now(),
    });
  });
}

async function seedZoteroOAuthToken(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("zoteroOAuthTokens", {
      token: "tok_test",
      tokenSecret: "sec_test",
      userId,
      expiresAt: Date.now() + 600_000,
    });
  });
}

// --- Tests ---

describe("purgeAllZoteroData", () => {
  it("purges all zoteroConnections and zoteroOAuthTokens", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    // Seed 2 connections with different zoteroUserIds
    await seedZoteroConnection(t, userId, { zoteroUserId: "11111" });
    await seedZoteroConnection(t, userId, { zoteroUserId: "22222" });

    // Seed 1 OAuth token
    await seedZoteroOAuthToken(t, userId);

    // Run purge
    const result = await t.mutation(
      internal.zotero.mutations.purgeAllZoteroData,
      {},
    );

    expect(result).toEqual({
      connectionsDeleted: 2,
      tokensDeleted: 1,
    });

    // Verify tables are empty
    await t.run(async (ctx) => {
      const connections = await ctx.db.query("zoteroConnections").collect();
      expect(connections).toHaveLength(0);
    });

    await t.run(async (ctx) => {
      const tokens = await ctx.db.query("zoteroOAuthTokens").collect();
      expect(tokens).toHaveLength(0);
    });
  });

  it("returns zero counts when tables are already empty", async () => {
    const t = convexTest(schema);

    const result = await t.mutation(
      internal.zotero.mutations.purgeAllZoteroData,
      {},
    );

    expect(result).toEqual({
      connectionsDeleted: 0,
      tokensDeleted: 0,
    });
  });
});
