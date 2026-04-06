import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

/**
 * Seed a user with a credits record at the specified balances.
 * Returns { userId, creditsId } for assertions.
 */
async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  freeBalance: number,
  paidBalance: number
) {
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

describe("deductCredits", () => {
  describe("single deduction", () => {
    it("deducts from free balance first", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 50);

      const newBalance = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 30, description: "test deduction" }
      );

      // Returns new total balance
      expect(newBalance).toBe(120); // 100 + 50 - 30 = 120

      // Verify credits record was updated
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(70); // 100 - 30
      expect(credits!.paidBalance).toBe(50); // unchanged
      expect(credits!.lifetimeUsed).toBe(30);

      // Verify a single "free" usage transaction was created
      const transactions = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .collect()
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe("usage");
      expect(transactions[0].creditType).toBe("free");
      expect(transactions[0].amount).toBe(-30);
      expect(transactions[0].balanceAfter).toBe(70);
    });

    it("splits deduction across free and paid when free < amount", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 20, 80);

      const newBalance = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 50, description: "split deduction" }
      );

      expect(newBalance).toBe(50); // 20 + 80 - 50 = 50

      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(0); // all free used
      expect(credits!.paidBalance).toBe(50); // 80 - 30 remaining paid
      expect(credits!.lifetimeUsed).toBe(50);

      // Verify two transactions: free usage + paid usage
      const transactions = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .collect()
      );
      expect(transactions).toHaveLength(2);

      const freeTx = transactions.find((tx) => tx.creditType === "free");
      const paidTx = transactions.find((tx) => tx.creditType === "paid");

      expect(freeTx).toBeDefined();
      expect(freeTx!.amount).toBe(-20); // all free credits used
      expect(freeTx!.balanceAfter).toBe(0);

      expect(paidTx).toBeDefined();
      expect(paidTx!.amount).toBe(-30); // 50 - 20 = 30 from paid
      expect(paidTx!.balanceAfter).toBe(50); // 80 - 30 = 50
    });

    it("throws INSUFFICIENT_CREDITS when balance is insufficient", async () => {
      const t = convexTest(schema);
      const { userId } = await seedUserWithCredits(t, 10, 5);

      await expect(
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 20,
          description: "too much",
        })
      ).rejects.toThrow("INSUFFICIENT_CREDITS");
    });

    it("deducts exact total balance leaving zero", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 30, 70);

      const newBalance = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 100, description: "exact deduction" }
      );

      expect(newBalance).toBe(0);

      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(0);
      expect(credits!.paidBalance).toBe(0);
      expect(credits!.lifetimeUsed).toBe(100);
    });
  });

  describe("sequential deductions (simulating concurrent access)", () => {
    // convex-test serializes mutations the same way OCC does in production.
    // These tests verify that the mutation logic correctly handles balance
    // state after previous deductions -- which is exactly what OCC
    // serialization achieves in production.

    it("two sequential deductions leave correct remaining balance", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // First deduction: 60 from 100 free
      const balance1 = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 60, description: "first deduction" }
      );
      expect(balance1).toBe(40);

      // Second deduction: 30 from remaining 40 free
      const balance2 = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 30, description: "second deduction" }
      );
      expect(balance2).toBe(10);

      // Verify final state
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(10);
      expect(credits!.paidBalance).toBe(0);
      expect(credits!.lifetimeUsed).toBe(90); // 60 + 30
    });

    it("second deduction fails when first exhausts balance", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 50, 0);

      // First deduction: takes all 50
      const balance1 = await t.mutation(
        internal.credits.internal.deductCredits,
        { userId, amount: 50, description: "exhaust balance" }
      );
      expect(balance1).toBe(0);

      // Second deduction: should fail -- balance is 0
      await expect(
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 10,
          description: "should fail",
        })
      ).rejects.toThrow("INSUFFICIENT_CREDITS");

      // Verify balance unchanged after failed deduction
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(0);
      expect(credits!.paidBalance).toBe(0);
      expect(credits!.lifetimeUsed).toBe(50);
    });
  });

  describe("concurrency", () => {
    // convex-test serializes mutations touching the same document, mimicking
    // Convex OCC in production. These tests prove the mutation logic is correct
    // under serialization -- which is exactly what OCC guarantees.

    it("OCC prevents negative balances under concurrent deductions", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // Fire 8 concurrent deductions of 30 each (total requested: 240, available: 100)
      // At most floor(100/30) = 3 can succeed under serialized execution
      const promises = Array.from({ length: 8 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 30,
          description: `concurrent-${i}`,
        })
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
          "INSUFFICIENT_CREDITS"
        );
      }

      // CRITICAL INVARIANT: balance is NEVER negative
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBeGreaterThanOrEqual(0);
      expect(credits!.paidBalance).toBeGreaterThanOrEqual(0);

      // Balance should equal starting - (successes * 30)
      const expectedBalance = 100 - successes.length * 30;
      expect(credits!.freeBalance).toBe(expectedBalance);
    });

    it("all deductions fail when each exceeds total balance", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 50, 0);

      // Fire 8 concurrent deductions of 60 each -- none can succeed (50 < 60)
      const promises = Array.from({ length: 8 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 60,
          description: `concurrent-fail-${i}`,
        })
      );
      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes.length).toBe(0);

      // Balance unchanged
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(50);
      expect(credits!.paidBalance).toBe(0);
      expect(credits!.lifetimeUsed).toBe(0);
    });

    it("concurrent deductions drain to zero without going negative", async () => {
      const t = convexTest(schema);
      const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

      // Fire 10 concurrent deductions of 10 each -- exactly 10 should succeed
      // (total requested = total available = 100)
      const promises = Array.from({ length: 10 }, (_, i) =>
        t.mutation(internal.credits.internal.deductCredits, {
          userId,
          amount: 10,
          description: `drain-${i}`,
        })
      );
      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes.length).toBe(10);

      // Balance is exactly 0
      const credits = await t.run(async (ctx) => ctx.db.get("credits", creditsId));
      expect(credits!.freeBalance).toBe(0);
      expect(credits!.paidBalance).toBe(0);
      expect(credits!.lifetimeUsed).toBe(100);
    });
  });
});
