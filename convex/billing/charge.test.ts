import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupAggregates } from "../extraction/aggregates.test-support";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "./billing.test-support";
import { convertUsdToCredits } from "../../lib/pricing";

/** OpenRouter's generation record for a failed chat turn that cost `usd`. */
function openRouterGeneration(usd: number) {
  return async () =>
    new Response(
      JSON.stringify({
        data: { id: "gen_1", model: "openai/gpt-6-luna", total_cost: usd },
      }),
      { status: 200 },
    );
}

async function seedChat(t: ReturnType<typeof convexTest>, credits: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_settle_${now}`,
      email: "settle@test.local",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, { userId, free: credits });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat" as const,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 0,
      name: "Chat",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId };
  });
}

async function usageFor(t: ReturnType<typeof convexTest>, chargeId: string) {
  const rows = await t.run((ctx) => ctx.db.query("billingUsage").collect());
  return rows.find((row) => row.chargeId === chargeId) ?? null;
}

async function hold(userId: Id<"users">, chargeId: string, credits: number) {
  const response = await fetch("https://autumn.test/v1/balances.check", {
    method: "POST",
    body: JSON.stringify({
      customer_id: userId,
      feature_id: "credits",
      required_balance: credits,
      lock: { enabled: true, lock_id: chargeId, expires_at: Date.now() + 60_000 },
    }),
  });
  expect(((await response.json()) as { allowed: boolean }).allowed).toBe(true);
}

describe("settling a charge", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    fakeAutumn.reset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("charges above the reservation, stopping at a zero balance", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch(openRouterGeneration(0.1)));
    const t = convexTest(schema);
    setupAggregates(t);
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(userId, "chat:over", 200);

    await t.action(internal.chat.billing.settleFromOpenRouter, {
      userId,
      jobId,
      chargeId: "chat:over",
      generationId: "gen_1",
      extraUsd: 0,
      attempt: 0,
    });

    // $0.10 is 1,300 credits; the account only had 1,000, and the log says 1,000.
    expect(convertUsdToCredits({ usd: 0.1 })).toBe(1_300);
    expect(fakeAutumn.balance(userId)).toBe(0);
    expect(fakeAutumn.locks.size).toBe(0);
    expect((await usageFor(t, "chat:over"))?.credits).toBe(1_000);
  });

  it("still charges once when the hold was released before the work finished", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch(openRouterGeneration(0.01)));
    const t = convexTest(schema);
    setupAggregates(t);
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(userId, "chat:late", 200);
    await t.action(internal.billing.charge.releaseLock, { userId, chargeId: "chat:late", attempt: 0 });
    expect(fakeAutumn.balance(userId)).toBe(1_000);

    const settle = () =>
      t.action(internal.chat.billing.settleFromOpenRouter, {
        userId,
        jobId,
        chargeId: "chat:late",
        generationId: "gen_1",
        extraUsd: 0,
        attempt: 0,
      });
    await settle();
    await settle();

    // $0.01 is 130 credits, charged once.
    expect(fakeAutumn.balance(userId)).toBe(1_000 - 130);
  });
  it("retries a settle that failed and charges it once", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch(openRouterGeneration(0.01)));
    const t = convexTest(schema);
    setupAggregates(t);
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(userId, "chat:retry", 200);
    fakeAutumn.failNextTrack = true;

    vi.useFakeTimers();
    await t.action(internal.chat.billing.settleFromOpenRouter, {
      userId,
      jobId,
      chargeId: "chat:retry",
      generationId: "gen_1",
      extraUsd: 0,
      attempt: 0,
    });
    expect(await usageFor(t, "chat:retry")).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    // $0.01 is 130 credits.
    expect(fakeAutumn.balance(userId)).toBe(1_000 - 130);
    expect((await usageFor(t, "chat:retry"))?.credits).toBe(130);
  });
});
