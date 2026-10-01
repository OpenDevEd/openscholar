import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { insertUsage } from "./usageLog";

async function setup() {
  const t = convexTest(schema);
  const { userId, jobId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {libraryItemCount: 0,  clerkId: "clerk_pages", email: "pages@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 });
    const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "chat", sourceType: "history", name: "c", messageCount: 0, createdAt: 0, updatedAt: 0 });
    return { userId, jobId };
  });
  return { t, userId, jobId, me: t.withIdentity({ subject: "clerk_pages" }) };
}

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

    const first = await me.query(api.billing.usage.pageMine, { page: 1, pageSize: 4 });
    expect(first.total).toBe(11);
    expect(first.rows.map((r) => r.credits)).toEqual([11, 10, 9, 8]);
    const last = await me.query(api.billing.usage.pageMine, { page: 3, pageSize: 4 });
    expect(last.rows.map((r) => r.credits)).toEqual([3, 2, 1]);

    const job = await me.query(api.billing.usage.pageMine, { page: 1, pageSize: 10, jobId });
    expect(job.total).toBe(5);
    expect(job.rows.map((r) => r.credits)).toEqual([10, 8, 6, 4, 2]);
  });

  it("counts charges recorded before the pages existed once the backfill runs", async () => {
    const { t, userId, me } = await setup();
    await t.run(async (ctx) => {
      for (let i = 1; i <= 3; i++) {
        await ctx.db.insert("billingUsage", { userId, chargeId: `old${i}`, credits: i, kind: "chat", description: "old", createdAt: i });
      }
    });
    expect((await me.query(api.billing.usage.pageMine, { page: 1, pageSize: 10 })).total).toBe(0);
    await t.mutation(internal.migrations.countBillingUsage.run, {});
    // Running it again counts nothing twice.
    await t.mutation(internal.migrations.countBillingUsage.run, {});
    const page = await me.query(api.billing.usage.pageMine, { page: 1, pageSize: 10 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.credits)).toEqual([3, 2, 1]);
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
    const cells = await me.query(api.billing.usage.spendingMine, { since, days: 2 });
    expect(cells).toEqual(
      expect.arrayContaining([
        { kind: "chat", day: 0, credits: 150 },
        { kind: "search", day: 1, credits: 7 },
      ]),
    );
    expect(cells).toHaveLength(2);
  });
});
