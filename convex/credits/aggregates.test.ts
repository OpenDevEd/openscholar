/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupTransactionAggregates } from "./aggregates.test-support";

const CLERK = "clerk_txn_facet_counts";

async function seedUserAndCredits(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "facet@test.local",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance: 10_000,
      paidBalance: 10_000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return { userId, creditsId };
  });
}

describe("transaction facet-count aggregates", () => {
  it("counts stay stable regardless of how many rows are loaded into the page", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserAndCredits(t);

    // 5 deducts → 5 usage/free rows in the ledger, populated via the
    // mutation path so recordTransactionCounters fires on every insert.
    for (let i = 0; i < 5; i++) {
      await t.mutation(internal.credits.internal.deductCredits, {
        userId,
        amount: 10,
        description: `t${i}`,
        billingType: "extraction_llm",
      });
    }

    const asUser = t.withIdentity({ subject: CLERK });
    const facets = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).not.toBeNull();
    expect(facets!.type.usage).toBe(5);
    expect(facets!.type.purchase).toBe(0);
    expect(facets!.type.grant).toBe(0);
    expect(facets!.type.refund).toBe(0);
    expect(facets!.type.expiry).toBe(0);
    expect(facets!.creditPool.free).toBe(5);
    expect(facets!.creditPool.paid).toBe(0);
    expect(facets!.billingType.extraction_llm).toBe(5);
    expect(facets!.billingType.embedding).toBe(0);
  });

  it("billingType=undefined row is absent from billingType aggregate but still counted by type + creditPool", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserAndCredits(t);

    // addCredits never sets billingType. The type + creditPool aggregates
    // must still count it; the billingType aggregate must leave every
    // bucket at 0.
    await t.mutation(internal.credits.internal.addCredits, {
      userId,
      amount: 100,
      type: "grant",
      creditType: "free",
    });

    const asUser = t.withIdentity({ subject: CLERK });
    const facets = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).not.toBeNull();
    expect(facets!.type.grant).toBe(1);
    expect(facets!.creditPool.free).toBe(1);
    // Every billingType bucket is 0 — the row had no billingType.
    const billingTotal = Object.values(facets!.billingType).reduce(
      (a, b) => a + b,
      0,
    );
    expect(billingTotal).toBe(0);
  });

  it("spillover deduct writes 2 rows — free + paid — and both land in the aggregates", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        clerkId: CLERK,
        email: "spill@test.local",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
      await ctx.db.insert("credits", {
        userId: uid,
        freeBalance: 10,
        paidBalance: 100,
        lifetimeUsed: 0,
        lastUpdatedAt: now,
      });
      return { userId: uid };
    });

    await t.mutation(internal.credits.internal.deductCredits, {
      userId,
      amount: 40, // exhausts 10 free, spills 30 into paid
      description: "spillover",
      billingType: "embedding",
    });

    const asUser = t.withIdentity({ subject: CLERK });
    const facets = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).not.toBeNull();
    expect(facets!.type.usage).toBe(2);
    expect(facets!.creditPool.free).toBe(1);
    expect(facets!.creditPool.paid).toBe(1);
    expect(facets!.billingType.embedding).toBe(2);
  });

  it("date-range bounds exclude out-of-range rows", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserAndCredits(t);

    await t.mutation(internal.credits.internal.deductCredits, {
      userId,
      amount: 5,
      description: "recent",
      billingType: "chat",
    });

    const asUser = t.withIdentity({ subject: CLERK });

    // A date range that ends before the row was inserted → count 0.
    const longAgo = Date.now() - 1_000_000_000;
    const beforeThat = longAgo - 86_400_000;
    const facetsNarrow = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      { from: beforeThat, to: longAgo },
    );
    expect(facetsNarrow!.type.usage).toBe(0);

    // A date range covering "now" → count 1.
    const wide = Date.now() + 86_400_000;
    const facetsWide = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      { from: beforeThat, to: wide },
    );
    expect(facetsWide!.type.usage).toBe(1);
  });

  it("returns null for unauthenticated callers", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const facets = await t.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).toBeNull();
  });

  it("returns null for a user with no credits record", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_nobody",
        email: "nobody@test.local",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
    });
    const asNobody = t.withIdentity({ subject: "clerk_nobody" });
    const facets = await asNobody.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).toBeNull();
  });

  it("empty ledger returns all-zero counts", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedUserAndCredits(t);
    const asUser = t.withIdentity({ subject: CLERK });
    const facets = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).not.toBeNull();
    const total =
      Object.values(facets!.type).reduce((a, b) => a + b, 0) +
      Object.values(facets!.creditPool).reduce((a, b) => a + b, 0) +
      Object.values(facets!.billingType).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("backfill migration populates aggregates for pre-existing rows idempotently", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { creditsId } = await seedUserAndCredits(t);

    // Seed rows BEFORE aggregates exist — bypass recordTransactionCounters
    // by using direct ctx.db.insert in t.run (simulates pre-migration data).
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("creditTransactions", {
          creditsId,
          type: "purchase",
          creditType: "paid",
          amount: 100,
          balanceAfter: 100,
          createdAt: now + i,
        });
      }
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("creditTransactions", {
          creditsId,
          type: "usage",
          creditType: "free",
          billingType: "screening",
          amount: -5,
          balanceAfter: 95,
          createdAt: now + 100 + i,
        });
      }
    });

    // Pre-backfill: aggregates are empty — counts are 0.
    const asUser = t.withIdentity({ subject: CLERK });
    const preBackfill = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(preBackfill!.type.purchase).toBe(0);
    expect(preBackfill!.type.usage).toBe(0);

    // Run the backfill.
    await t.mutation(
      internal.migrations.backfillTransactionCounters.run,
      { cursor: null },
    );

    const postBackfill = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(postBackfill!.type.purchase).toBe(3);
    expect(postBackfill!.type.usage).toBe(2);
    expect(postBackfill!.creditPool.paid).toBe(3);
    expect(postBackfill!.creditPool.free).toBe(2);
    expect(postBackfill!.billingType.screening).toBe(2);

    // Idempotency: re-running must be a no-op.
    await t.mutation(
      internal.migrations.backfillTransactionCounters.run,
      { cursor: null },
    );
    const postSecondRun = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(postSecondRun!.type.purchase).toBe(3);
    expect(postSecondRun!.type.usage).toBe(2);
  });
});
