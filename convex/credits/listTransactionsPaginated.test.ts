import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";

type CreditTransactionInsert = Omit<
  Doc<"creditTransactions">,
  "_id" | "_creationTime"
>;

async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance: 1000,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return { userId, creditsId };
  });
}

async function insertTxn(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<CreditTransactionInsert> &
    Pick<CreditTransactionInsert, "creditsId">,
): Promise<Id<"creditTransactions">> {
  return await t.run(async (ctx) => {
    const doc: CreditTransactionInsert = {
      creditsId: overrides.creditsId,
      type: overrides.type ?? "purchase",
      creditType: overrides.creditType ?? "paid",
      amount: overrides.amount ?? 100,
      balanceAfter: overrides.balanceAfter ?? 100,
      createdAt: overrides.createdAt ?? Date.now(),
      ...(overrides.description !== undefined
        ? { description: overrides.description }
        : {}),
      ...(overrides.userId !== undefined ? { userId: overrides.userId } : {}),
      ...(overrides.jobId !== undefined ? { jobId: overrides.jobId } : {}),
      ...(overrides.billingType !== undefined
        ? { billingType: overrides.billingType }
        : {}),
      ...(overrides.metadata !== undefined
        ? { metadata: overrides.metadata }
        : {}),
      ...(overrides.stripeInvoiceId !== undefined
        ? { stripeInvoiceId: overrides.stripeInvoiceId }
        : {}),
    };
    return await ctx.db.insert("creditTransactions", doc);
  });
}

describe("listTransactionsPaginated", () => {
  it("empty user (no credits row) → empty paginated result", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_nobody",
        email: "nobody@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
    });
    const asUser = t.withIdentity({ subject: "clerk_nobody" });

    const result = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe("");
  });

  it("unauthenticated caller → empty paginated result", async () => {
    const t = convexTest(schema);
    const result = await t.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe("");
  });

  it("happy path: returns PaginationResult with page/isDone/continueCursor", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_happy",
      "happy@test.com",
    );
    for (let i = 0; i < 3; i++) {
      await insertTxn(t, { creditsId, amount: i + 1 });
    }
    const asUser = t.withIdentity({ subject: "clerk_happy" });

    const result = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.isDone).toBe(true);
    expect(typeof result.continueCursor).toBe("string");
  });

  it("paginates across multiple pages when numItems < total", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_paginate",
      "paginate@test.com",
    );
    for (let i = 0; i < 5; i++) {
      await insertTxn(t, { creditsId, amount: i + 1 });
    }
    const asUser = t.withIdentity({ subject: "clerk_paginate" });

    const first = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).not.toBe("");

    const second = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(2);
    expect(second.isDone).toBe(false);

    const third = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 2, cursor: second.continueCursor },
    });
    expect(third.page).toHaveLength(1);
    expect(third.isDone).toBe(true);
  });

  it("single-type filter uses the index path and returns only matching type", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_type",
      "type@test.com",
    );
    await insertTxn(t, { creditsId, type: "purchase", amount: 100 });
    await insertTxn(t, { creditsId, type: "usage", amount: -50 });
    await insertTxn(t, { creditsId, type: "purchase", amount: 200 });
    await insertTxn(t, { creditsId, type: "grant", amount: 10 });
    const asUser = t.withIdentity({ subject: "clerk_type" });

    const result = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      types: ["purchase"],
    });

    expect(result.page).toHaveLength(2);
    for (const row of result.page) {
      expect(row.type).toBe("purchase");
    }
  });

  it("multi-type filter post-filters on by_credits and returns both kinds", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_multi",
      "multi@test.com",
    );
    await insertTxn(t, { creditsId, type: "purchase" });
    await insertTxn(t, { creditsId, type: "usage", amount: -10 });
    await insertTxn(t, { creditsId, type: "grant", amount: 10 });
    await insertTxn(t, { creditsId, type: "expiry", amount: -5 });
    const asUser = t.withIdentity({ subject: "clerk_multi" });

    const result = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      types: ["purchase", "grant"],
    });

    const seenTypes = new Set(result.page.map((row) => row.type));
    expect(seenTypes).toEqual(new Set(["purchase", "grant"]));
    expect(result.page.every((r) => r.type !== "usage" && r.type !== "expiry")).toBe(true);
  });

  it("date range narrows by createdAt inclusively", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_range",
      "range@test.com",
    );
    await insertTxn(t, { creditsId, createdAt: 50 });
    await insertTxn(t, { creditsId, createdAt: 100 });
    await insertTxn(t, { creditsId, createdAt: 150 });
    await insertTxn(t, { creditsId, createdAt: 200 });
    await insertTxn(t, { creditsId, createdAt: 250 });
    const asUser = t.withIdentity({ subject: "clerk_range" });

    const result = await asUser.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      from: 100,
      to: 200,
    });

    const times = result.page.map((r) => r.createdAt).sort((a, b) => a - b);
    expect(times).toEqual([100, 150, 200]);
  });

  it("ownership: user A's rows never appear in user B's query", async () => {
    const t = convexTest(schema);
    const { creditsId: creditsA } = await seedUserWithCredits(
      t,
      "clerk_a",
      "a@test.com",
    );
    const { creditsId: creditsB } = await seedUserWithCredits(
      t,
      "clerk_b",
      "b@test.com",
    );
    await insertTxn(t, {
      creditsId: creditsA,
      description: "A only",
      amount: 100,
    });
    await insertTxn(t, {
      creditsId: creditsB,
      description: "B only",
      amount: 200,
    });
    const asB = t.withIdentity({ subject: "clerk_b" });

    const result = await asB.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].creditsId).toBe(creditsB);
    expect(result.page[0].description).toBe("B only");
  });

  it("jobId path scopes to by_job + enforces ownership", async () => {
    const t = convexTest(schema);
    const { userId: userA, creditsId: creditsA } = await seedUserWithCredits(
      t,
      "clerk_ja",
      "ja@test.com",
    );
    const { creditsId: creditsB } = await seedUserWithCredits(
      t,
      "clerk_jb",
      "jb@test.com",
    );

    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("extractionJobs", {
        userId: userA,
        mode: "extraction" as const,
        name: "Test Job",
        status: "pending" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await insertTxn(t, {
      creditsId: creditsA,
      type: "usage",
      amount: -10,
      jobId,
    });
    await insertTxn(t, {
      creditsId: creditsA,
      type: "usage",
      amount: -20,
      jobId,
    });
    await insertTxn(t, {
      creditsId: creditsB,
      type: "usage",
      amount: -50,
      jobId,
    });
    await insertTxn(t, { creditsId: creditsA, type: "purchase", amount: 100 });

    const asA = t.withIdentity({ subject: "clerk_ja" });
    const result = await asA.query(api.credits.queries.listTransactionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      jobId,
    });

    expect(result.page).toHaveLength(2);
    for (const row of result.page) {
      expect(row.creditsId).toBe(creditsA);
      expect(row.jobId).toBe(jobId);
    }
  });
});

describe("getTransactions backwards-compat", () => {
  it("still returns a plain array for the existing caller shape", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_compat",
      "compat@test.com",
    );
    await insertTxn(t, { creditsId, amount: 100 });
    await insertTxn(t, { creditsId, amount: 200 });
    const asUser = t.withIdentity({ subject: "clerk_compat" });

    const result = await asUser.query(api.credits.queries.getTransactions, {
      limit: 50,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});

describe("getTransactions searchableText drift (plan-01)", () => {
  it("preserves searchableText on the wire when the row stores it", async () => {
    const t = convexTest(schema);
    const { creditsId } = await seedUserWithCredits(
      t,
      "clerk_searchable",
      "searchable@test.com",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("creditTransactions", {
        creditsId,
        type: "usage" as const,
        creditType: "paid" as const,
        amount: -25,
        balanceAfter: 75,
        createdAt: Date.now(),
        searchableText: "manual extraction job · openrouter/anthropic",
      });
    });
    const asUser = t.withIdentity({ subject: "clerk_searchable" });

    const result = await asUser.query(api.credits.queries.getTransactions, {
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].searchableText).toBe(
      "manual extraction job · openrouter/anthropic",
    );
  });
});
