import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { seedCreditsForTest } from "./billing.test-support";
import { insertUsage } from "./ledger";

async function setup() {
  const t = convexTest(schema);
  const { userId, jobId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {libraryItemCount: 0,  clerkId: "clerk_pages", email: "pages@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 });
    const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "chat", sourceType: "history", name: "c", messageCount: 0, createdAt: 0, updatedAt: 0 });
    return { userId, jobId };
  });
  return { t, userId, jobId, me: t.withIdentity({ subject: "clerk_pages" }) };
}

/** Charges are counted by the ledger worker, a moment after they're recorded. */
async function counted(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// The workers schedule their runs on whichever timers are active when charges are recorded.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("charge pages", () => {
  it("pages through charges newest first, with the total, overall and for one job", async () => {
    const { t, userId, jobId, me } = await setup();
    await t.run(async (ctx) => {
      for (let i = 1; i <= 11; i++) {
        await insertUsage(ctx, {
          userId, chargeId: `c${i}`, credits: i, kind: "search", description: `charge ${i}`, createdAt: i * 1000,
          ...(i % 2 === 0 ? { jobId } : {}),
        });
      }
    });
    await counted(t);

    const page = (cursor: string | null, numItems: number, of: { jobId?: typeof jobId } = {}) => me.query(api.billing.usage.listCharges, { ...of, paginationOpts: { cursor, numItems } });
    const first = await page(null, 4);
    expect(await me.query(api.billing.usage.countCharges, {})).toBe(11);
    expect(first.page.map((r) => r.credits)).toEqual([11, 10, 9, 8]);
    const second = await page(first.continueCursor, 4);
    const last = await page(second.continueCursor, 4);
    expect(last.page.map((r) => r.credits)).toEqual([3, 2, 1]);
    expect(last.isDone).toBe(true);

    expect(await me.query(api.billing.usage.countCharges, { jobId })).toBe(5);
    expect((await page(null, 10, { jobId })).page.map((r) => r.credits)).toEqual([10, 8, 6, 4, 2]);

    // Someone else reads none of the job's charges.
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "clerk_other", email: "other@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 }));
    const other = t.withIdentity({ subject: "clerk_other" });
    expect((await other.query(api.billing.usage.listCharges, { jobId, paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
    expect(await other.query(api.billing.usage.countCharges, { jobId })).toBe(0);
  });

  it("lists a job's charges by their time, whatever order they were recorded in", async () => {
    const { t, userId, jobId, me } = await setup();
    await t.run(async (ctx) => {
      for (const [chargeId, createdAt] of [["late", 2000], ["early", 1000]] as const) {
        await insertUsage(ctx, { userId, chargeId, credits: 1, kind: "extraction", description: chargeId, createdAt, jobId });
      }
    });
    const page = await me.query(api.billing.usage.listCharges, { jobId, paginationOpts: { cursor: null, numItems: 10 } });
    expect(page.page.map((r) => r.description)).toEqual(["late", "early"]);
  });

  it("counts charges recorded before the pages existed once the backfill runs", async () => {
    const { t, userId, me } = await setup();
    await t.run(async (ctx) => {
      for (let i = 1; i <= 3; i++) {
        await ctx.db.insert("billingUsage", { userId, chargeId: `old${i}`, credits: i, kind: "chat", description: "old", createdAt: i });
      }
    });
    expect(await me.query(api.billing.usage.countCharges, {})).toBe(0);
    await t.mutation(internal.migrations.countBillingUsage.run, {});
    // Running it again counts nothing twice.
    await t.mutation(internal.migrations.countBillingUsage.run, {});
    await counted(t);
    expect(await me.query(api.billing.usage.countCharges, {})).toBe(3);
    expect((await me.query(api.billing.usage.listCharges, { paginationOpts: { cursor: null, numItems: 10 } })).page.map((r) => r.credits)).toEqual([3, 2, 1]);
  });

  it("says how many credits the person has to spend", async () => {
    const { t, userId, me } = await setup();
    expect(await me.query(api.billing.usage.balance, {})).toEqual({ credits: 0 });
    await t.run(async (ctx) => seedCreditsForTest(ctx, { userId, free: 300, paid: 200 }));
    expect(await me.query(api.billing.usage.balance, {})).toEqual({ credits: 500 });
  });

  it("totals each day's spending by kind, leaving refunds out", async () => {
    const { t, userId, me } = await setup();
    const DAY = 86_400_000;
    const since = 10 * DAY;
    await t.run(async (ctx) => {
      const row = (chargeId: string, kind: "chat" | "search" | "refund", credits: number, createdAt: number) =>
        insertUsage(ctx, { userId, chargeId, credits, kind, description: chargeId, createdAt });
      await row("a", "chat", 100, since + 1);
      await row("b", "chat", 50, since + DAY - 1);
      await row("c", "search", 7, since + DAY);
      await row("d", "refund", 0, since + DAY);
      await row("before", "chat", 999, since - 1);
    });
    await counted(t);
    const cells = (await me.query(api.billing.usage.spending, { since, days: 2 })).page;
    expect(cells).toEqual(
      expect.arrayContaining([
        { kind: "chat", day: 0, credits: 150 },
        { kind: "search", day: 1, credits: 7 },
      ]),
    );
    expect(cells).toHaveLength(2);
  });
});
