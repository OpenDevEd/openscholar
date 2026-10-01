import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal, api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  seedCreditsForTest,
} from "../billing/billing.test-support";

// ─── Seed helpers ────────────────────────────────────────────

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides?: { email?: string; clerkId?: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: overrides?.clerkId ?? "clerk_wallet_test",
      email: overrides?.email ?? "wallet@test.com",
      firstName: "Wallet",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    return userId;
  });
}

async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  freeBalance: number,
  paidBalance: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: "clerk_wallet_credit_test",
      email: "walletcredit@test.com",
      firstName: "Wallet",
      lastName: "Credit",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    await seedCreditsForTest(ctx, {
      userId,
      free: freeBalance,
      paid: paidBalance,
      now,
    });

    return { userId };
  });
}

async function seedWalletKey(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides?: { hashedKey?: string; isActive?: boolean; appName?: string },
) {
  return await t.run(async (ctx) => {
    const walletKeyId = await ctx.db.insert("walletKeys", {
      userId,
      hashedKey: overrides?.hashedKey ?? "testhash_abc123",
      keyPrefix: "wk_test...",
      appName: overrides?.appName ?? "TestApp",
      redirectOrigin: "https://test.com",
      isActive: overrides?.isActive ?? true,
      createdAt: Date.now(),
    });
    return walletKeyId;
  });
}

// ─── Schema tests ────────────────────────────────────────────

describe("walletKeys schema", () => {
  it("creates a wallet key record with all fields", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const walletKeyId = await seedWalletKey(t, userId, {
      appName: "MyApp",
      hashedKey: "sha256_deadbeef",
    });

    const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
    expect(record).not.toBeNull();
    expect(record!.userId).toBe(userId);
    expect(record!.hashedKey).toBe("sha256_deadbeef");
    expect(record!.appName).toBe("MyApp");
    expect(record!.redirectOrigin).toBe("https://test.com");
    expect(record!.isActive).toBe(true);
    expect(record!.keyPrefix).toBe("wk_test...");
  });

  it("supports by_hashed_key index lookup", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await seedWalletKey(t, userId, { hashedKey: "unique_hash_123" });

    const found = await t.run(async (ctx) =>
      ctx.db
        .query("walletKeys")
        .withIndex("by_hashed_key", (q) => q.eq("hashedKey", "unique_hash_123"))
        .unique(),
    );
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(userId);
  });

  it("supports by_user index lookup", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await seedWalletKey(t, userId, { hashedKey: "hash_a" });
    await seedWalletKey(t, userId, { hashedKey: "hash_b", appName: "App2" });

    const keys = await t.run(async (ctx) =>
      ctx.db
        .query("walletKeys")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(keys).toHaveLength(2);
  });
});

// ─── Internal mutation tests ─────────────────────────────────

describe("wallet internal mutations", () => {
  describe("insertKey", () => {
    it("inserts a wallet key record", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);

      const walletKeyId = await t.mutation(internal.wallet.internal.insertKey, {
        userId,
        hashedKey: "test_insert_hash",
        keyPrefix: "wk_ins...",
        appName: "InsertTest",
        redirectOrigin: "https://insert.com",
      });

      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record).not.toBeNull();
      expect(record!.isActive).toBe(true);
      expect(record!.hashedKey).toBe("test_insert_hash");
    });
  });

  describe("lookupKey", () => {
    it("returns userId and appName for active key", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId, {
        hashedKey: "lookup_hash",
        appName: "LookupApp",
      });

      const result = await t.query(internal.wallet.internal.lookupKey, {
        hashedKey: "lookup_hash",
      });

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(userId);
      expect(result!.walletKeyId).toBe(walletKeyId);
      expect(result!.appName).toBe("LookupApp");
    });

    it("returns null for non-existent hash", async () => {
      const t = convexTest(schema);

      const result = await t.query(internal.wallet.internal.lookupKey, {
        hashedKey: "does_not_exist",
      });

      expect(result).toBeNull();
    });

    it("returns null for inactive key", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      await seedWalletKey(t, userId, {
        hashedKey: "inactive_hash",
        isActive: false,
      });

      const result = await t.query(internal.wallet.internal.lookupKey, {
        hashedKey: "inactive_hash",
      });

      expect(result).toBeNull();
    });
  });

  describe("touchKeyUsage", () => {
    it("updates lastUsedAt timestamp", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId);

      // Initially no lastUsedAt
      const before = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(before!.lastUsedAt).toBeUndefined();

      await t.mutation(internal.wallet.internal.touchKeyUsage, { walletKeyId });

      const after = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(after!.lastUsedAt).toBeDefined();
      expect(after!.lastUsedAt).toBeGreaterThan(0);
    });
  });

  describe("revokeKey", () => {
    it("sets isActive to false for the correct user", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId);

      const result = await t.mutation(internal.wallet.internal.revokeKey, {
        walletKeyId,
        userId,
      });

      expect(result).toBe(true);

      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record!.isActive).toBe(false);
    });

    it("returns false for wrong user", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t, { clerkId: "clerk_a", email: "a@test.com" });
      const otherUserId = await seedUser(t, { clerkId: "clerk_b", email: "b@test.com" });
      const walletKeyId = await seedWalletKey(t, userId);

      const result = await t.mutation(internal.wallet.internal.revokeKey, {
        walletKeyId,
        userId: otherUserId,
      });

      expect(result).toBe(false);

      // Key should still be active
      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record!.isActive).toBe(true);
    });

    it("returns false when key belongs to different user and revoke attempted by another", async () => {
      const t = convexTest(schema);
      const userA = await seedUser(t, { clerkId: "clerk_revoke_a", email: "revoke_a@test.com" });
      const userB = await seedUser(t, { clerkId: "clerk_revoke_b", email: "revoke_b@test.com" });
      const walletKeyId = await seedWalletKey(t, userA, { hashedKey: "revoke_ownership" });

      // userB tries to revoke userA's key
      const result = await t.mutation(internal.wallet.internal.revokeKey, {
        walletKeyId,
        userId: userB,
      });

      expect(result).toBe(false);

      // Key still active
      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record!.isActive).toBe(true);
    });
  });

  describe("lookupById", () => {
    it("returns appName and redirectOrigin for valid key and user", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId, { appName: "ByIdApp" });

      const result = await t.query(internal.wallet.internal.lookupById, {
        walletKeyId,
        userId,
      });

      expect(result).not.toBeNull();
      expect(result!.appName).toBe("ByIdApp");
      expect(result!.redirectOrigin).toBe("https://test.com");
    });

    it("returns null for wrong user", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t, { clerkId: "clerk_x", email: "x@test.com" });
      const otherUserId = await seedUser(t, { clerkId: "clerk_y", email: "y@test.com" });
      const walletKeyId = await seedWalletKey(t, userId);

      const result = await t.query(internal.wallet.internal.lookupById, {
        walletKeyId,
        userId: otherUserId,
      });

      expect(result).toBeNull();
    });
  });

  describe("removePendingKey", () => {
    it("deletes key with __pending__ hash", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId, {
        hashedKey: "__pending__",
      });

      await t.mutation(internal.wallet.internal.removePendingKey, { walletKeyId });

      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record).toBeNull();
    });

    it("does NOT delete key with real hash", async () => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const walletKeyId = await seedWalletKey(t, userId, {
        hashedKey: "real_hash_not_pending",
      });

      await t.mutation(internal.wallet.internal.removePendingKey, { walletKeyId });

      const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
      expect(record).not.toBeNull();
      expect(record!.hashedKey).toBe("real_hash_not_pending");
    });
  });
});

// ─── Integration: key lookup ────────────────────────────────

describe("wallet key lookup", () => {
  it("a revoked key is not found", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserWithCredits(t, 100, 0);
    const walletKeyId = await seedWalletKey(t, userId, {
      hashedKey: "revoke_test_hash",
    });

    // Revoke the key
    await t.mutation(internal.wallet.internal.revokeKey, {
      walletKeyId,
      userId,
    });

    // Lookup should return null
    const keyResult = await t.query(internal.wallet.internal.lookupKey, {
      hashedKey: "revoke_test_hash",
    });
    expect(keyResult).toBeNull();
  });
});

// ─── Models table (unified) ─────────────────────────────────

async function seedModel(
  t: ReturnType<typeof convexTest>,
  overrides?: Partial<{
    modelId: string;
    name: string;
    provider: string;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    isServed: boolean;
    sortOrder: number;
  }>,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("models", {
      modelId: overrides?.modelId ?? "openai/test-model",
      name: overrides?.name ?? "Test Model",
      provider: overrides?.provider ?? "openai",
      inputPricePerMillion: overrides?.inputPricePerMillion ?? 1.0,
      outputPricePerMillion: overrides?.outputPricePerMillion ?? 5.0,
      costMarkup: 1.3,
      isServed: overrides?.isServed ?? true,
      sortOrder: overrides?.sortOrder ?? 1,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("models (unified table)", () => {
  describe("listServed", () => {
    it("returns only served models", async () => {
      const t = convexTest(schema);
      await seedModel(t, { modelId: "openai/active-1", isServed: true });
      await seedModel(t, { modelId: "openai/active-2", isServed: true });
      await seedModel(t, { modelId: "openai/inactive-1", isServed: false });

      const models = await t.query(internal.models.queries.listServed);
      const ids = models.map((m) => m.modelId);
      expect(ids).toContain("openai/active-1");
      expect(ids).toContain("openai/active-2");
      expect(ids).not.toContain("openai/inactive-1");
    });

    it("returns empty array when no models exist", async () => {
      const t = convexTest(schema);
      const models = await t.query(internal.models.queries.listServed);
      expect(models).toHaveLength(0);
    });
  });

  describe("getServedByModelId", () => {
    it("returns served model by modelId", async () => {
      const t = convexTest(schema);
      await seedModel(t, {
        modelId: "openai/gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      });

      const model = await t.query(internal.models.queries.getServedByModelId, {
        modelId: "openai/gpt-4o",
      });

      expect(model).not.toBeNull();
      expect(model!.name).toBe("GPT-4o");
      expect(model!.provider).toBe("openai");
      expect(model!.inputPricePerMillion).toBe(2.5);
      expect(model!.outputPricePerMillion).toBe(10.0);
      expect(model!.costMarkup).toBe(1.3);
    });

    it("returns null for non-served model", async () => {
      const t = convexTest(schema);
      await seedModel(t, { modelId: "openai/disabled-model", isServed: false });

      const model = await t.query(internal.models.queries.getServedByModelId, {
        modelId: "openai/disabled-model",
      });
      expect(model).toBeNull();
    });

    it("returns null for non-existent model", async () => {
      const t = convexTest(schema);

      const model = await t.query(internal.models.queries.getServedByModelId, {
        modelId: "openai/does-not-exist",
      });
      expect(model).toBeNull();
    });
  });

  describe("getPricing", () => {
    it("returns pricing for a model", async () => {
      const t = convexTest(schema);
      await seedModel(t, {
        modelId: "anthropic/claude-sonnet-4-5",
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      });

      const pricing = await t.query(internal.models.queries.getPricing, {
        modelId: "anthropic/claude-sonnet-4-5",
      });

      expect(pricing).toEqual({ input: 3.0, output: 15.0 });
    });

    it("returns null for non-existent model", async () => {
      const t = convexTest(schema);

      const pricing = await t.query(internal.models.queries.getPricing, {
        modelId: "openai/nonexistent",
      });
      expect(pricing).toBeNull();
    });
  });

  describe("setServed mutation", () => {
    it("toggles isServed and updates overrides", async () => {
      const t = convexTest(schema);
      await seedModel(t, { modelId: "openai/toggle-test", isServed: false });

      await t.mutation(internal.models.mutations.setServed, {
        modelId: "openai/toggle-test",
        isServed: true,
        costMarkup: 1.5,
        sortOrder: 5,
        category: "flagship",
      });

      const served = await t.query(internal.models.queries.getServedByModelId, {
        modelId: "openai/toggle-test",
      });
      expect(served).not.toBeNull();
      expect(served!.isServed).toBe(true);
      expect(served!.costMarkup).toBe(1.5);
      expect(served!.sortOrder).toBe(5);
      expect(served!.category).toBe("flagship");
    });
  });
});
