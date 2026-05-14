/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { setupTransactionAggregates, seedCreditsForTest } from "./aggregates.test-support";
import { deductCreditsTransaction } from "./internal";
import { readBalance } from "./balanceCounter";

/**
 * Test seed: create the `credits` anchor row and seed initial pools via
 * `seedCreditsForTest`, which emits `grant`/`purchase` ledger
 * transactions that drive the `balanceFreeCounter` /
 * `balancePaidCounter` shards through `recordTransactionCounters`. The
 * legacy `freeBalance|paidBalance|lifetimeUsed|lastUpdatedAt` columns
 * are gone — balances are derived from the append-only ledger summed by
 * sharded counters.
 *
 * Tests that assert on usage transactions filter by `type === "usage"`
 * so the seed `grant`/`purchase` rows do not pollute the assertion.
 */
async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  freeBalance: number,
  paidBalance: number,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_credit_test",
      email: "credit@test.com",
      firstName: "Credit",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free: freeBalance,
      paid: paidBalance,
      now,
    });

    return { userId, creditsId };
  });
}

describe("deductCredits", () => {
  describe("single deduction", () => {
    it("deducts from free balance first", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 50);

      const { deducted, remaining } = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 30, description: "test deduction" },
      );

      expect(deducted).toBe(30);
      expect(remaining).toBe(120); // 100 + 50 - 30 = 120

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(70); // 100 - 30
      expect(balance.paid).toBe(50); // unchanged
      expect(balance.total).toBe(120);

      // One usage transaction; seed grant + purchase rows are filtered out.
      const usages = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(1);
      expect(usages[0].creditType).toBe("free");
      expect(usages[0].amount).toBe(-30);
    });

    it("splits deduction across free and paid when free < amount", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 20, 80);

      const { deducted, remaining } = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 50, description: "split deduction" },
      );

      expect(deducted).toBe(50);
      expect(remaining).toBe(50); // 20 + 80 - 50 = 50

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0); // all free used
      expect(balance.paid).toBe(50); // 80 - 30 remaining paid
      expect(balance.total).toBe(50);

      // Two usage rows: free drained, paid spillover. Seed rows excluded.
      const usages = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(2);

      const freeTx = usages.find((tx) => tx.creditType === "free");
      const paidTx = usages.find((tx) => tx.creditType === "paid");

      expect(freeTx).toBeDefined();
      expect(freeTx!.amount).toBe(-20); // all free credits used

      expect(paidTx).toBeDefined();
      expect(paidTx!.amount).toBe(-30); // 50 - 20 = 30 from paid
    });

    it("throws INSUFFICIENT_CREDITS when balance is insufficient", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId } = await seedUserWithCredits(t, 10, 5);

      await expect(
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 20,
          description: "too much",
        }),
      ).rejects.toThrow("INSUFFICIENT_CREDITS");
    });

    it("deducts exact total balance leaving zero", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 30, 70);

      const { deducted, remaining } = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 100, description: "exact deduction" },
      );

      expect(deducted).toBe(100);
      expect(remaining).toBe(0);

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(0);
    });
  });

  describe("sequential deductions (simulating concurrent access)", () => {
    // convex-test serializes mutations the same way OCC does in production.
    // These tests verify that the mutation logic correctly handles balance
    // state after previous deductions -- which is exactly what OCC
    // serialization achieves in production.

    it("two sequential deductions leave correct remaining balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // First deduction: 60 from 100 free
      const first = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 60, description: "first deduction" },
      );
      expect(first.remaining).toBe(40);

      // Second deduction: 30 from remaining 40 free
      const second = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 30, description: "second deduction" },
      );
      expect(second.remaining).toBe(10);

      // Verify final state via the aggregate-derived balance.
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(10);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(10);
    });

    it("second deduction fails when first exhausts balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 50, 0);

      // First deduction: takes all 50
      const first = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 50, description: "exhaust balance" },
      );
      expect(first.remaining).toBe(0);

      // Second deduction: should fail -- balance is 0
      await expect(
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 10,
          description: "should fail",
        }),
      ).rejects.toThrow("INSUFFICIENT_CREDITS");

      // Verify balance unchanged after failed deduction
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(0);
    });
  });

  describe("concurrency", () => {
    // convex-test serializes mutations touching the same document, mimicking
    // Convex OCC in production. These tests prove the mutation logic is correct
    // under serialization -- which is exactly what OCC guarantees.

    it("OCC prevents negative balances under concurrent deductions", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // Fire 8 concurrent deductions of 30 each (total requested: 240, available: 100)
      // At most floor(100/30) = 3 can succeed under serialized execution
      const promises = Array.from({ length: 8 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 30,
          description: `concurrent-${i}`,
        }),
      );
      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // At most 3 can succeed (100 / 30 = 3.33, floor = 3)
      expect(successes.length).toBeLessThanOrEqual(3);
      expect(failures.length).toBeGreaterThanOrEqual(5);

      // Every failure should be INSUFFICIENT_CREDITS
      for (const f of failures) {
        expect((f as PromiseRejectedResult).reason.message).toContain(
          "INSUFFICIENT_CREDITS",
        );
      }

      // CRITICAL INVARIANT: balance is NEVER negative
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBeGreaterThanOrEqual(0);
      expect(balance.paid).toBeGreaterThanOrEqual(0);

      // Balance should equal starting - (successes * 30)
      const expectedBalance = 100 - successes.length * 30;
      expect(balance.free).toBe(expectedBalance);
    });

    it("all deductions fail when each exceeds total balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 50, 0);

      // Fire 8 concurrent deductions of 60 each -- none can succeed (50 < 60)
      const promises = Array.from({ length: 8 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 60,
          description: `concurrent-fail-${i}`,
        }),
      );
      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes.length).toBe(0);

      // Balance unchanged
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(50);
      expect(balance.paid).toBe(0);
    });

    it("concurrent deductions drain to zero without going negative", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // Fire 10 concurrent deductions of 10 each -- exactly 10 should succeed
      // (total requested = total available = 100)
      const promises = Array.from({ length: 10 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 10,
          description: `drain-${i}`,
        }),
      );
      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes.length).toBe(10);

      // Balance is exactly 0
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(0);
    });
  });

  describe("allowPartial drain-to-zero", () => {
    // Chat billing opts in to allowPartial: the pre-flight floor is the
    // gate, so once we reach billing the user has some balance. Any
    // shortfall versus the actual provider cost is small and gets eaten —
    // the alternative (throw + roll back the row patch) leaves the
    // chatGenerationUsages ledger lying about whether billing happened.

    it("caps deduction at totalAvailable, returns deducted+remaining", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 313, 0);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 550,
          description: "AI: Chat message",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 313, remaining: 0 });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(0);

      const usages = await t.run((ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(1);
      expect(usages[0].amount).toBe(-313);
      expect(usages[0].metadata?.requestedCredits).toBe("550");
      expect(usages[0].metadata?.shortfall).toBe("237");
    });

    it("returns {0,0} and writes nothing when balance is exactly zero", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 0, 0);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 100,
          description: "AI: Chat message",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 0, remaining: 0 });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(0);

      // No usage rows written. Seed rows are skipped here because both
      // free and paid were 0 — seedCreditsForTest only emits a tx when
      // the pool is non-zero.
      const usages = await t.run((ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(0);
    });

    it("behaves identically to the non-partial path when balance covers amount", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 1000, 0);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 250,
          description: "AI: Chat message",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 250, remaining: 750 });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(750);
      expect(balance.total).toBe(750);

      const usages = await t.run((ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      // No shortfall metadata when there was no shortfall.
      expect(usages[0].metadata?.requestedCredits).toBeUndefined();
      expect(usages[0].metadata?.shortfall).toBeUndefined();
    });

    it("drains across free then paid pools when both are partially needed", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 50);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 200,
          description: "AI: Chat message",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 150, remaining: 0 });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.paid).toBe(0);
      expect(balance.total).toBe(0);

      const usages = await t.run((ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(2);
      const free = usages.find((tx) => tx.creditType === "free")!;
      const paid = usages.find((tx) => tx.creditType === "paid")!;
      expect(free.amount).toBe(-100);
      expect(paid.amount).toBe(-50);
      expect(free.metadata?.shortfall).toBe("50");
      expect(paid.metadata?.shortfall).toBe("50");
    });
  });

  describe("negative-balance floor", () => {
    // Regression for the compounding-negative bug. Tier D removed the OCC
    // serialization the shared credits cell used to provide; if a wallet
    // does go underwater (drained reservation, race in a legacy code
    // path, dev seed drift), every subsequent `deductCreditsTransaction`
    // with `allowPartial: true` must NOT emit a usage row that drives
    // the balance further negative. The historical bug — observed at the
    // -500 dev wallet — was `Math.min(args.amount, balance.total)`
    // returning a negative value when `balance.total < 0`, then
    // `paidUsed = amountToDeduct - freeUsed` becoming positive and
    // inserting a usage row that bled the wallet by another 38 credits.
    it("writes nothing when total balance is negative", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 0, 0);

      // Force the wallet underwater by inserting a synthetic usage row
      // and registering it with the aggregate, mirroring the production
      // overdraft state we observed.
      await t.run(async (ctx) => {
        const now = Date.now();
        const txId = await ctx.db.insert("creditTransactions", {
          creditsId,
          userId,
          type: "usage",
          creditType: "free",
          amount: -500,
          description: "synthetic overdraft",
          createdAt: now,
        });
        const { recordTransactionCounters } = await import("./aggregates");
        await recordTransactionCounters(ctx, {
          _id: txId,
          creditsId,
          type: "usage",
          creditType: "free",
          amount: -500,
          createdAt: now,
        });
      });

      const before = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(before.total).toBe(-500);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 12,
          description: "must not bleed further",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 0, remaining: -500 });

      const after = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(after.total).toBe(-500);

      // No NEW usage rows emitted — the synthetic seed row is the only
      // usage row in the table.
      const usages = await t.run((ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(1);
      expect(usages[0].description).toBe("synthetic overdraft");
    });

    it("writes nothing when split balance is partly-negative but total<=0", async () => {
      // free=-500, paid=200, total=-300. The historical bug emitted a
      // paid-pool usage row whose math drove the wallet further negative
      // (freeUsed=-500, paidUsed = amountToDeduct - freeUsed > 0 → insert
      // -paidUsed). The floor must catch this before the per-pool split.
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 0, 200);

      await t.run(async (ctx) => {
        const now = Date.now();
        const txId = await ctx.db.insert("creditTransactions", {
          creditsId,
          userId,
          type: "usage",
          creditType: "free",
          amount: -500,
          description: "synthetic overdraft (free pool)",
          createdAt: now,
        });
        const { recordTransactionCounters } = await import("./aggregates");
        await recordTransactionCounters(ctx, {
          _id: txId,
          creditsId,
          type: "usage",
          creditType: "free",
          amount: -500,
          createdAt: now,
        });
      });

      const before = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(before.free).toBe(-500);
      expect(before.paid).toBe(200);
      expect(before.total).toBe(-300);

      const result = await t.run((ctx) =>
        deductCreditsTransaction(ctx, {
          userId,
          amount: 100,
          description: "must not bleed further from paid pool",
          billingType: "chat",
          allowPartial: true,
        }),
      );

      expect(result).toEqual({ deducted: 0, remaining: -300 });

      const after = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(after.free).toBe(-500);
      expect(after.paid).toBe(200);
      expect(after.total).toBe(-300);
    });
  });

  describe("public mutation forwards allowPartial", () => {
    // Coverage for the public deductCredits mutation surface (wraps
    // deductCreditsTransaction): the rest of the allowPartial behavior
    // is tested at the transaction level above. These tests just prove
    // the validator accepts the flag and the return shape carries
    // {deducted, remaining}.

    it("public mutation accepts allowPartial:true and caps at totalAvailable", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      const result = await t.mutation(
        internal.credits.internal.deductCredits,
        {
          userId,
          amount: 250,
          description: "AI: Chat message",
          billingType: "chat",
          allowPartial: true,
        },
      );

      expect(result).toEqual({ deducted: 100, remaining: 0 });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0);
      expect(balance.total).toBe(0);
    });

    it("public mutation without allowPartial still throws on shortfall", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId } = await seedUserWithCredits(t, 100, 0);

      await expect(
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 250,
          description: "AI: Chat message",
          billingType: "chat",
        }),
      ).rejects.toThrow("INSUFFICIENT_CREDITS");
    });
  });
});
