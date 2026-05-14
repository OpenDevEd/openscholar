/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "./aggregates.test-support";
import { readBalance } from "./balanceCounter";
import {
  reserveCreditsTransaction,
  releaseReservationTransaction,
  settleReservationTransaction,
} from "./reservation";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  free: number,
  paid: number,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_reservation_test",
      email: "reservation@test.local",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free,
      paid,
      now,
    });
    return { userId, creditsId };
  });
}

describe("reservation primitive", () => {
  describe("reserve", () => {
    it("holds the estimate against free pool first", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 50);

      const result = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 30, description: "test reservation" },
      );

      expect(result.reserved).toBe(30);
      expect(result.remaining).toBe(120);
      expect(result.reservationId).not.toBeNull();

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(70); // 100 - 30
      expect(balance.paid).toBe(50);
      expect(balance.total).toBe(120);

      const reservations = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation"))
          .collect(),
      );
      expect(reservations).toHaveLength(1);
      expect(reservations[0].creditType).toBe("free");
      expect(reservations[0].amount).toBe(-30);
      expect(reservations[0].reservationOf).toBeUndefined();
    });

    it("spills into paid pool when free is insufficient", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 20, 100);

      const result = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 50, billingType: "embedding" },
      );

      expect(result.reserved).toBe(50);

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(0); // 20 - 20
      expect(balance.paid).toBe(70); // 100 - 30
      expect(balance.total).toBe(70);

      const reservations = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation"))
          .collect(),
      );
      expect(reservations).toHaveLength(2);

      const free = reservations.find((r) => r.creditType === "free");
      const paid = reservations.find((r) => r.creditType === "paid");
      expect(free?.amount).toBe(-20);
      expect(paid?.amount).toBe(-30);
      expect(free?.reservationOf).toBeUndefined();
      // Sibling row links back to the free primary.
      expect(paid?.reservationOf).toBe(free?._id);
      // Both carry the caller scope.
      expect(free?.billingType).toBe("embedding");
      expect(paid?.billingType).toBe("embedding");
    });

    it("throws INSUFFICIENT_CREDITS when wallet can't cover the estimate", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId } = await seedUser(t, 10, 10);

      await expect(
        t.mutation(internal.credits.reservation.reserveCredits, {
          userId,
          amount: 50,
        }),
      ).rejects.toThrow(/INSUFFICIENT_CREDITS|Insufficient credits/);
    });

    it("amount=0 is a no-op that returns the current balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 50);

      const result = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 0 },
      );

      expect(result.reservationId).toBeNull();
      expect(result.reserved).toBe(0);
      expect(result.remaining).toBe(150);

      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation"))
          .collect(),
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("release", () => {
    it("offsets a single-pool reservation back to full balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 40 },
      );

      const release = await t.mutation(
        internal.credits.reservation.releaseReservation,
        { reservationId: reserve.reservationId! },
      );

      expect(release.released).toBe(40);
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(100);
      expect(balance.total).toBe(100);
    });

    it("releases both members of a split reservation", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 30, 70);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 80 },
      );

      const release = await t.mutation(
        internal.credits.reservation.releaseReservation,
        { reservationId: reserve.reservationId! },
      );

      expect(release.released).toBe(80);

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.free).toBe(30);
      expect(balance.paid).toBe(70);
      expect(balance.total).toBe(100);

      const releases = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation_release"))
          .collect(),
      );
      expect(releases).toHaveLength(2);
    });

    it("is idempotent — a second release is a no-op", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 40 },
      );

      const first = await t.mutation(
        internal.credits.reservation.releaseReservation,
        { reservationId: reserve.reservationId! },
      );
      const second = await t.mutation(
        internal.credits.reservation.releaseReservation,
        { reservationId: reserve.reservationId! },
      );

      expect(first.released).toBe(40);
      expect(second.released).toBe(0); // already released

      // Only one release row exists in the ledger.
      const releases = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation_release"))
          .collect(),
      );
      expect(releases).toHaveLength(1);
    });

    it("accepts a sibling _id as the handle and still releases the whole group", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 30, 70);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 80 },
      );

      // Find the paid sibling and call release with its _id.
      const siblingId = await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "reservation"))
          .collect();
        const sibling = rows.find((r) => r.creditType === "paid");
        if (!sibling) throw new Error("expected paid sibling row");
        // sanity: it must point at the primary
        expect(sibling.reservationOf).toBe(reserve.reservationId);
        return sibling._id;
      });

      const release = await t.mutation(
        internal.credits.reservation.releaseReservation,
        { reservationId: siblingId },
      );

      expect(release.released).toBe(80);
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(100);
    });

    it("throws NOT_FOUND for an unknown reservation handle", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      // Insert a non-reservation row and try to release it.
      const fakeId = await t.run(async (ctx) => {
        return await ctx.db.insert("creditTransactions", {
          creditsId,
          userId,
          type: "usage",
          creditType: "free",
          amount: -10,
          createdAt: Date.now(),
        });
      });

      await expect(
        t.mutation(internal.credits.reservation.releaseReservation, {
          reservationId: fakeId,
        }),
      ).rejects.toThrow(/NOT_FOUND|Reservation not found/);
    });
  });

  describe("settle", () => {
    it("releases the hold and records actuals lower than estimate", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 200, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 80, billingType: "extraction_llm" },
      );

      const settle = await t.mutation(
        internal.credits.reservation.settleReservation,
        {
          reservationId: reserve.reservationId!,
          userId,
          actualCost: 50,
          billingType: "extraction_llm",
          description: "AI: extraction settled",
        },
      );

      expect(settle.released).toBe(80);
      expect(settle.usage.deducted).toBe(50);

      // 200 - actuals(50) = 150 net.
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(150);
      expect(balance.free).toBe(150); // free pool drained 50

      // One reservation, one release, one usage row.
      const allRows = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .collect(),
      );
      const byType = (t: string) => allRows.filter((r) => r.type === t);
      expect(byType("reservation")).toHaveLength(1);
      expect(byType("reservation_release")).toHaveLength(1);
      expect(byType("usage")).toHaveLength(1);
      expect(byType("usage")[0].amount).toBe(-50);
    });

    it("handles actuals higher than estimate against the post-release balance", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 200, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 50 },
      );

      const settle = await t.mutation(
        internal.credits.reservation.settleReservation,
        {
          reservationId: reserve.reservationId!,
          userId,
          actualCost: 120, // overran the estimate
        },
      );

      expect(settle.released).toBe(50);
      expect(settle.usage.deducted).toBe(120);
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(80); // 200 - 120
    });

    it("with allowPartial drains to zero on extreme actuals overrun", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 50, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 30 },
      );

      const settle = await t.mutation(
        internal.credits.reservation.settleReservation,
        {
          reservationId: reserve.reservationId!,
          userId,
          actualCost: 9999, // way more than the 50-credit wallet
          allowPartial: true,
        },
      );

      expect(settle.usage.deducted).toBe(50);
      expect(settle.usage.remaining).toBe(0);
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(0);
    });

    it("zero actuals = pure release, no usage row", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      const reserve = await t.mutation(
        internal.credits.reservation.reserveCredits,
        { userId, amount: 40 },
      );

      const settle = await t.mutation(
        internal.credits.reservation.settleReservation,
        { reservationId: reserve.reservationId!, userId, actualCost: 0 },
      );

      expect(settle.released).toBe(40);
      expect(settle.usage.deducted).toBe(0);
      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(100);

      const usages = await t.run(async (ctx) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
          .filter((q) => q.eq(q.field("type"), "usage"))
          .collect(),
      );
      expect(usages).toHaveLength(0);
    });
  });

  describe("plain-helper API parity", () => {
    it("reserveCreditsTransaction can be called inline within a mutation context", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      const handle = await t.run(async (ctx) => {
        const r = await reserveCreditsTransaction(ctx, {
          userId,
          amount: 25,
        });
        return r.reservationId!;
      });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(75);

      await t.run(async (ctx) => {
        const r = await settleReservationTransaction(ctx, {
          reservationId: handle,
          userId,
          actualCost: 20,
        });
        expect(r.released).toBe(25);
        expect(r.usage.deducted).toBe(20);
      });

      const final = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(final.total).toBe(80); // 100 - 20 actuals
    });

    it("releaseReservationTransaction matches the public mutation behavior", async () => {
      const t = convexTest(schema);
      setupTransactionAggregates(t);
      const { userId, creditsId } = await seedUser(t, 100, 0);

      const handle = await t.run(async (ctx) => {
        const r = await reserveCreditsTransaction(ctx, {
          userId,
          amount: 30,
        });
        return r.reservationId!;
      });

      await t.run(async (ctx) => {
        await releaseReservationTransaction(ctx, { reservationId: handle });
      });

      const balance = await t.run((ctx) => readBalance(ctx, creditsId));
      expect(balance.total).toBe(100);
    });
  });
});
