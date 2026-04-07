import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal, api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

// ─── Seed helpers ────────────────────────────────────────────

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides?: { email?: string; clerkId?: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
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
      clerkId: "clerk_wallet_credit_test",
      email: "walletcredit@test.com",
      firstName: "Wallet",
      lastName: "Credit",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance,
      paidBalance,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });

    return { userId, creditsId };
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

// ─── Integration: key lookup + credit check ──────────────────

describe("wallet + credits integration", () => {
  it("lookupKey returns userId that can be used for balance check", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserWithCredits(t, 100, 50);
    await seedWalletKey(t, userId, { hashedKey: "integration_hash" });

    // Step 1: lookup key
    const keyResult = await t.query(internal.wallet.internal.lookupKey, {
      hashedKey: "integration_hash",
    });
    expect(keyResult).not.toBeNull();

    // Step 2: check balance using the returned userId
    const balance = await t.query(internal.credits.internal.getBalanceByUserId, {
      userId: keyResult!.userId,
    });
    expect(balance).not.toBeNull();
    expect(balance!.total).toBe(150);
    expect(balance!.free).toBe(100);
    expect(balance!.paid).toBe(50);
  });

  it("lookupKey → deductCredits chain works correctly", async () => {
    const t = convexTest(schema);
    const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);
    await seedWalletKey(t, userId, { hashedKey: "deduct_chain_hash" });

    // Step 1: lookup key
    const keyResult = await t.query(internal.wallet.internal.lookupKey, {
      hashedKey: "deduct_chain_hash",
    });
    expect(keyResult).not.toBeNull();

    // Step 2: deduct credits
    const remaining = await t.mutation(internal.credits.internal.deductCredits, {
      userId: keyResult!.userId,
      amount: 25,
      description: "Wallet API: gpt-4o-mini",
      metadata: {
        source: "wallet_api",
        appName: "TestApp",
        model: "gpt-4o-mini",
        provider: "openai",
      },
    });
    expect(remaining).toBe(75);

    // Verify transaction recorded correctly
    const transactions = await t.run(async (ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
        .collect(),
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].description).toBe("Wallet API: gpt-4o-mini");
    expect(transactions[0].metadata?.source).toBe("wallet_api");
    expect(transactions[0].metadata?.appName).toBe("TestApp");
  });

  it("revoked key cannot be used for balance check", async () => {
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

// ─── Wallet models (DB-based) ────────────────────────────────

async function seedWalletModel(
  t: ReturnType<typeof convexTest>,
  overrides?: Partial<{
    modelId: string;
    name: string;
    provider: "openai" | "anthropic" | "google" | "deepseek" | "azure" | "openrouter";
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    isActive: boolean;
    sortOrder: number;
  }>,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("walletModels", {
      modelId: overrides?.modelId ?? "test-model",
      name: overrides?.name ?? "Test Model",
      provider: overrides?.provider ?? "openai",
      inputPricePerMillion: overrides?.inputPricePerMillion ?? 1.0,
      outputPricePerMillion: overrides?.outputPricePerMillion ?? 5.0,
      costMarkup: 1.3,
      capabilities: ["function-calling"],
      isActive: overrides?.isActive ?? true,
      sortOrder: overrides?.sortOrder ?? 1,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("wallet models (DB)", () => {
  describe("listActive", () => {
    it("returns only active models", async () => {
      const t = convexTest(schema);
      await seedWalletModel(t, { modelId: "active-1", isActive: true });
      await seedWalletModel(t, { modelId: "active-2", isActive: true });
      await seedWalletModel(t, { modelId: "inactive-1", isActive: false });

      const models = await t.query(internal.wallet.models.listActive);
      const ids = models.map((m) => m.modelId);
      expect(ids).toContain("active-1");
      expect(ids).toContain("active-2");
      expect(ids).not.toContain("inactive-1");
    });

    it("returns empty array when no models exist", async () => {
      const t = convexTest(schema);
      const models = await t.query(internal.wallet.models.listActive);
      expect(models).toHaveLength(0);
    });
  });

  describe("getByModelId", () => {
    it("returns active model by modelId", async () => {
      const t = convexTest(schema);
      await seedWalletModel(t, {
        modelId: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10.0,
      });

      const model = await t.query(internal.wallet.models.getByModelId, {
        modelId: "gpt-4o",
      });

      expect(model).not.toBeNull();
      expect(model!.name).toBe("GPT-4o");
      expect(model!.provider).toBe("openai");
      expect(model!.inputPricePerMillion).toBe(2.5);
      expect(model!.outputPricePerMillion).toBe(10.0);
      expect(model!.costMarkup).toBe(1.3);
    });

    it("returns null for inactive model", async () => {
      const t = convexTest(schema);
      await seedWalletModel(t, { modelId: "disabled-model", isActive: false });

      const model = await t.query(internal.wallet.models.getByModelId, {
        modelId: "disabled-model",
      });
      expect(model).toBeNull();
    });

    it("returns null for non-existent model", async () => {
      const t = convexTest(schema);

      const model = await t.query(internal.wallet.models.getByModelId, {
        modelId: "does-not-exist",
      });
      expect(model).toBeNull();
    });
  });

  describe("add mutation", () => {
    it("creates a new model with defaults", async () => {
      const t = convexTest(schema);

      const id = await t.mutation(api.wallet.models.add, {
        modelId: "new-model",
        name: "New Model",
        provider: "anthropic",
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      });

      const record = await t.run(async (ctx) => ctx.db.get(id));
      expect(record).not.toBeNull();
      expect(record!.modelId).toBe("new-model");
      expect(record!.costMarkup).toBe(1.3); // default
      expect(record!.isActive).toBe(true);
      expect(record!.sortOrder).toBe(100); // default
      expect(record!.capabilities).toEqual([]);
    });

    it("rejects duplicate modelId", async () => {
      const t = convexTest(schema);
      await seedWalletModel(t, { modelId: "duplicate-test" });

      await expect(
        t.mutation(api.wallet.models.add, {
          modelId: "duplicate-test",
          name: "Dupe",
          provider: "openai",
          inputPricePerMillion: 1.0,
          outputPricePerMillion: 5.0,
        }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("update mutation", () => {
    it("patches fields without overwriting others", async () => {
      const t = convexTest(schema);
      const id = await seedWalletModel(t, {
        modelId: "patch-test",
        name: "Original",
        inputPricePerMillion: 1.0,
      });

      await t.mutation(api.wallet.models.update, {
        id,
        name: "Updated",
        inputPricePerMillion: 2.0,
      });

      const record = await t.run(async (ctx) => ctx.db.get(id));
      expect(record!.name).toBe("Updated");
      expect(record!.inputPricePerMillion).toBe(2.0);
      expect(record!.outputPricePerMillion).toBe(5.0); // unchanged
      expect(record!.modelId).toBe("patch-test"); // unchanged
    });

    it("can deactivate a model", async () => {
      const t = convexTest(schema);
      const id = await seedWalletModel(t, { modelId: "deactivate-test" });

      await t.mutation(api.wallet.models.update, { id, isActive: false });

      const record = await t.run(async (ctx) => ctx.db.get(id));
      expect(record!.isActive).toBe(false);

      // Should no longer appear in getByModelId
      const lookup = await t.query(internal.wallet.models.getByModelId, {
        modelId: "deactivate-test",
      });
      expect(lookup).toBeNull();
    });
  });

  describe("remove mutation", () => {
    it("deletes the model", async () => {
      const t = convexTest(schema);
      const id = await seedWalletModel(t, { modelId: "remove-test" });

      await t.mutation(api.wallet.models.remove, { id });

      const record = await t.run(async (ctx) => ctx.db.get(id));
      expect(record).toBeNull();
    });
  });
});
