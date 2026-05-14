/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupTransactionAggregates, seedCreditsForTest } from "./aggregates.test-support";

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
    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free: 10_000,
      paid: 10_000,
      now,
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
    // Seed emits 1 purchase + 1 grant via seedCreditsForTest.
    expect(facets!.type.purchase).toBe(1);
    expect(facets!.type.grant).toBe(1);
    expect(facets!.type.refund).toBe(0);
    expect(facets!.type.expiry).toBe(0);
    // 1 seed grant on free + 5 usage rows on free.
    expect(facets!.creditPool.free).toBe(6);
    // 1 seed purchase on paid.
    expect(facets!.creditPool.paid).toBe(1);
    expect(facets!.billingType.extraction_llm).toBe(5);
    expect(facets!.billingType.embedding).toBe(0);
  });

  it("billingType=undefined row is absent from billingType aggregate but still counted by type + creditPool", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    // Seed with an empty wallet so `addCredits(100, free)` actually lands
    // a row — `seedUserAndCredits` would prime free=10_000 which already
    // exceeds the free plan's 500 cap, so the production `addCredits`
    // path would return early without inserting.
    const { userId } = await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        clerkId: CLERK,
        email: "facet-billingless@test.local",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
      await seedCreditsForTest(ctx, { userId: uid, free: 0, paid: 0, now });
      return { userId: uid };
    });

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
    // Seed inserts no grant row when free=0/paid=0, so the addCredits
    // grant is the only row in either aggregate.
    expect(facets!.type.grant).toBe(1);
    expect(facets!.creditPool.free).toBe(1);
    // Every billingType bucket is 0 — neither the seed grant nor the
    // addCredits grant carry a billingType.
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
      await seedCreditsForTest(ctx, { userId: uid, free: 10, paid: 100, now });
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
    // 1 seed grant on free + 1 usage on free.
    expect(facets!.creditPool.free).toBe(2);
    // 1 seed purchase on paid + 1 usage on paid.
    expect(facets!.creditPool.paid).toBe(2);
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

  it("seed-only ledger returns counts equal to the seed grant + purchase rows", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedUserAndCredits(t);
    const asUser = t.withIdentity({ subject: CLERK });
    const facets = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(facets).not.toBeNull();
    // Every credits row anchors a seed grant + purchase tx so the
    // sharded balance counters have summands to read. The facet
    // aggregates surface those rows as `grant=1` / `purchase=1`.
    expect(facets!.type.grant).toBe(1);
    expect(facets!.type.purchase).toBe(1);
    expect(facets!.type.usage).toBe(0);
    expect(facets!.creditPool.free).toBe(1);
    expect(facets!.creditPool.paid).toBe(1);
    // Neither seed row carries a billingType.
    const billingTotal = Object.values(facets!.billingType).reduce(
      (a, b) => a + b,
      0,
    );
    expect(billingTotal).toBe(0);
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
          createdAt: now + 100 + i,
        });
      }
    });

    // Pre-backfill: only the seed grant + purchase from seedUserAndCredits
    // appear in the aggregates (the bypass inserts have not been backfilled).
    const asUser = t.withIdentity({ subject: CLERK });
    const preBackfill = await asUser.query(
      api.credits.queries.getTransactionFacetCounts,
      {},
    );
    expect(preBackfill!.type.purchase).toBe(1);
    expect(preBackfill!.type.grant).toBe(1);
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
    // Seed (1 purchase) + 3 backfilled purchases.
    expect(postBackfill!.type.purchase).toBe(4);
    expect(postBackfill!.type.usage).toBe(2);
    // Seed paid (1) + 3 backfilled paid purchases.
    expect(postBackfill!.creditPool.paid).toBe(4);
    // Seed free (1) + 2 backfilled free usages.
    expect(postBackfill!.creditPool.free).toBe(3);
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
    expect(postSecondRun!.type.purchase).toBe(4);
    expect(postSecondRun!.type.usage).toBe(2);
  });
});
