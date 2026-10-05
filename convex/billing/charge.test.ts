import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "./billing.test-support";
import { insertUsage } from "./ledger";
import { requestRefresh } from "./accounts";
import { creditsAgg } from "../extraction/aggregates";
import { convertUsdToCredits } from "../../lib/pricing";

/** OpenRouter's generation record for a failed chat turn that cost `usd`. */
function openRouterGeneration(usd: number) {
  return async () =>
    new Response(
      JSON.stringify({
        data: { id: "gen_1", model: "openai/gpt-6-luna", total_cost: usd, native_tokens_cached: 300, native_tokens_reasoning: 20 },
      }),
      { status: 200 },
    );
}

const NO_TOKENS = { cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };

async function seedChat(t: ReturnType<typeof convexTest>, credits: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
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

/** Holds credits as reserveCredits does: the hold with its scheduled release, then Autumn's lock. */
async function hold(t: ReturnType<typeof convexTest>, userId: Id<"users">, chargeId: string, credits: number, spend?: true) {
  await t.mutation(internal.billing.charge.hold, { userId, chargeId, credits, expiresAt: Date.now() + 60_000, ...(spend ? { spend } : {}) });
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
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(t, userId, "chat:over", 200);

    await t.action(internal.chat.billing.settleFromOpenRouter, {
      userId,
      jobId,
      chargeId: "chat:over",
      generationId: "gen_1",
      extraUsd: 0,
      earlierTokens: NO_TOKENS,
      attempt: 0,
    });

    // $0.10 is 1,300 credits; the account only had 1,000, and the log says 1,000.
    expect(convertUsdToCredits({ usd: 0.1 })).toBe(1_300);
    expect(fakeAutumn.balance(userId)).toBe(0);
    expect(fakeAutumn.locks.size).toBe(0);
    expect((await usageFor(t, "chat:over"))?.credits).toBe(1_000);
  });

  it("records the cache and reasoning tokens of the earlier steps and the stopped one", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch(openRouterGeneration(0.01)));
    const t = convexTest(schema);
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(t, userId, "chat:stopped", 200);

    await t.action(internal.chat.billing.settleFromOpenRouter, {
      userId,
      jobId,
      chargeId: "chat:stopped",
      generationId: "gen_1",
      extraUsd: 0,
      earlierTokens: { cacheReadTokens: 4_000, cacheWriteTokens: 150, reasoningTokens: 40 },
      attempt: 0,
    });

    expect(await usageFor(t, "chat:stopped")).toMatchObject({ cacheReadTokens: 4_300, cacheWriteTokens: 150, reasoningTokens: 60 });
  });

  it("still charges once when the hold was released before the work finished", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch(openRouterGeneration(0.01)));
    const t = convexTest(schema);
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(t, userId, "chat:late", 200);
    await t.action(internal.billing.charge.releaseLock, { userId, chargeId: "chat:late", attempt: 0 });
    expect(fakeAutumn.balance(userId)).toBe(1_000);

    const settle = () =>
      t.action(internal.chat.billing.settleFromOpenRouter, {
        userId,
        jobId,
        chargeId: "chat:late",
        generationId: "gen_1",
        extraUsd: 0,
        earlierTokens: NO_TOKENS,
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
    const { userId, jobId } = await seedChat(t, 1_000);
    await hold(t, userId, "chat:retry", 200);
    fakeAutumn.failNext = "balances.finalize";

    vi.useFakeTimers();
    await t.action(internal.chat.billing.settleFromOpenRouter, {
      userId,
      jobId,
      chargeId: "chat:retry",
      generationId: "gen_1",
      extraUsd: 0,
      earlierTokens: NO_TOKENS,
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

describe("holding and charging", () => {
  beforeEach(() => fakeAutumn.reset());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const usage = { kind: "screening" as const, description: "Bulk screening" };
  const calls = (path: string) => fakeAutumn.calls.filter((call) => call.path === path);
  const releases = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((fn) => fn.name.includes("releaseLock")),
    );

  it("confirms a held charge at its real amount with one call, and cancels its release", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "c:held", 200);

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:held", credits: 130, usage, attempt: 0 });

    expect(fakeAutumn.balance(userId)).toBe(870);
    expect(fakeAutumn.locks.size).toBe(0);
    expect(calls("balances.finalize").map((call) => call.body)).toEqual([{ lock_id: "c:held", action: "confirm", override_value: 130 }]);
    expect(calls("balances.track")).toHaveLength(0);
    expect((await releases(t)).map((fn) => fn.state.kind)).toEqual(["canceled"]);
    expect(await t.run((ctx) => ctx.db.query("billingHolds").collect())).toEqual([]);
  });

  it("doesn't charge again when a confirm landed and recording it failed", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "c:landed", 200);
    // The first attempt began, confirmed, and failed before recording the charge.
    await t.mutation(internal.billing.charge.beginSettle, { userId, chargeId: "c:landed", credits: 130, usage });
    await fetch("https://autumn.test/v1/balances.finalize", {
      method: "POST",
      body: JSON.stringify({ lock_id: "c:landed", action: "confirm", override_value: 130 }),
    });

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:landed", credits: 130, usage, attempt: 0 });

    expect(fakeAutumn.balance(userId)).toBe(870);
    expect((await usageFor(t, "c:landed"))?.credits).toBe(130);
  });

  it("charges bulk work without a hold, down to zero, and zeroes the cached balance when it runs out", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 10);

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:bulk", credits: 30, usage, attempt: 0 });

    expect(calls("balances.check")).toHaveLength(0);
    expect(fakeAutumn.balance(userId)).toBe(0);
    expect((await usageFor(t, "c:bulk"))?.credits).toBe(10);
    // Before the queued refresh runs, so parallel papers stop at once.
    expect(await t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())?.balance)).toBe(0);
  });

  it("charges the rest of a cost above the hold and the balance once, though the first try failed after confirming", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 250);
    await hold(t, userId, "c:over", 200);
    fakeAutumn.failNext = "balances.track";

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:over", credits: 300, usage, attempt: 0 });
    // The hold is confirmed; the rest failed and is retried.
    expect(fakeAutumn.balance(userId)).toBe(50);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fakeAutumn.balance(userId)).toBe(0);
    expect((await usageFor(t, "c:over"))?.credits).toBe(250);
  });

  it("frees and charges a lock reserved before holds were recorded", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 100);
    // The lock alone, as the old reservation took it.
    await fetch("https://autumn.test/v1/balances.check", {
      method: "POST",
      body: JSON.stringify({ customer_id: userId, feature_id: "credits", required_balance: 80, lock: { enabled: true, lock_id: "c:legacy", expires_at: Date.now() + 60_000 } }),
    });

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:legacy", credits: 60, usage, attempt: 0 });

    expect(fakeAutumn.locks.size).toBe(0);
    expect(fakeAutumn.balance(userId)).toBe(40);
    expect((await usageFor(t, "c:legacy"))?.credits).toBe(60);
  });

  it("keeps a balance a charge emptied, top-ups included, over a refresh that read Autumn before it", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 10);
    await t.run(async (ctx) => {
      const account = await ctx.db.query("billingAccounts").first();
      await ctx.db.patch("billingAccounts", account!._id, { purchased: 5 });
    });
    const fetchedAt = Date.now();
    await t.mutation(internal.billing.accounts.zeroBalance, { userId });
    expect(await t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())?.purchased)).toBe(0);
    const snapshot = await t.run(async (ctx) => {
      const { _id, _creationTime, userId: _user, refreshedAt, refreshQueuedAt, ...rest } = (await ctx.db.query("billingAccounts").first())!;
      return { ...rest, balance: 10 };
    });

    await t.mutation(internal.billing.accounts.writeSnapshot, { userId, snapshot, withCard: false, fetchedAt: fetchedAt - 1 });

    expect(await t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())?.balance)).toBe(0);
  });

  it("settles a held charge whose action ended right after it cancelled the release", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "c:died", 200);
    // The settle began, cancelling the release, and its action went no further.
    await t.mutation(internal.billing.charge.beginSettle, { userId, chargeId: "c:died", credits: 130, usage });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fakeAutumn.locks.size).toBe(0);
    expect(fakeAutumn.balance(userId)).toBe(870);
    expect((await usageFor(t, "c:died"))?.credits).toBe(130);
  });

  it("gives back a lock reserved before holds were recorded when the work costs nothing", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 100);
    await fetch("https://autumn.test/v1/balances.check", {
      method: "POST",
      body: JSON.stringify({ customer_id: userId, feature_id: "credits", required_balance: 80, lock: { enabled: true, lock_id: "c:free", expires_at: Date.now() + 60_000 } }),
    });

    await t.action(internal.billing.charge.retrySettle, { userId, chargeId: "c:free", credits: 0, usage, attempt: 0 });

    expect(fakeAutumn.locks.size).toBe(0);
    expect(fakeAutumn.balance(userId)).toBe(100);
  });

  it("re-reads the account from Autumn once for a burst of charges, without asking Stripe for the card", async () => {
    vi.stubGlobal("fetch", fakeAutumnFetch());
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await t.run(async (ctx) => {
      const account = await ctx.db.query("billingAccounts").first();
      await ctx.db.patch("billingAccounts", account!._id, { card: { brand: "visa", last4: "4242" } });
    });

    for (let i = 0; i < 5; i++) {
      await t.action(internal.billing.charge.retrySettle, { userId, chargeId: `c:burst${i}`, credits: 10, usage, attempt: 0 });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls("customers.get_or_create").map((call) => call.body.expand)).toEqual([undefined]);
    const account = await t.run((ctx) => ctx.db.query("billingAccounts").first());
    expect(account).toMatchObject({ balance: 950, card: { brand: "visa", last4: "4242" } });
    expect(account?.refreshQueuedAt).toBeUndefined();
  });

  it("shows the signed-in user their account while a re-read from Autumn is queued", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    const user = await t.run(async (ctx) => {
      await requestRefresh(ctx, userId);
      return await ctx.db.get(userId);
    });

    const account = await t.withIdentity({ subject: user!.clerkId }).query(api.billing.accounts.mine, {});

    expect(account).toMatchObject({ balance: 1_000 });
  });
});

describe("an approved job's hold", () => {
  beforeEach(() => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const calls = (path: string) => fakeAutumn.calls.filter((call) => call.path === path);
  const usage = { kind: "extraction" as const, description: "Extraction" };
  const record = (t: ReturnType<typeof convexTest>, userId: Id<"users">, n: number, credits: number) =>
    t.mutation(internal.billing.charge.recordUnder, { userId, chargeId: `paper:${n}`, credits, ...usage, under: "job:1", createdAt: Date.now() });
  /** Settles the hold as its job's end does, and lets the confirm it schedules run: not the takeover, a quarter of an hour on. */
  const settle = async (t: ReturnType<typeof convexTest>, attempt = 0) => {
    await t.mutation(internal.billing.charge.settleSpent, { chargeId: "job:1", attempt });
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  };
  const spent = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.query("billingUsage").collect()).map((row) => row.credits));
  const holds = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("billingHolds").collect());
  /** What the hold has scheduled and not yet run, by function. */
  const coming = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect())
        .filter((fn) => fn.state.kind === "pending")
        .map((fn) => fn.name.split(":").at(-1)!)
        .filter((name) => name === "settleSpent" || name === "confirmSpent"),
    );

  it("charges nothing for its items, then confirms once with their sum", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "job:1", 200, true);

    // Each item is on the ledger, and Autumn hears of none of them.
    expect([await record(t, userId, 0, 40), await record(t, userId, 1, 50), await record(t, userId, 2, 30)]).toEqual([true, true, true]);
    // One recorded twice, as a retried action would, is one charge.
    await record(t, userId, 0, 40);
    expect(await spent(t)).toEqual([40, 50, 30]);
    expect(calls("balances.track")).toHaveLength(0);
    expect(calls("balances.finalize")).toHaveLength(0);

    await settle(t);
    expect(calls("balances.finalize").map((call) => call.body)).toEqual([{ lock_id: "job:1", action: "confirm", override_value: 120 }]);
    expect(fakeAutumn.balance(userId)).toBe(880);
    expect(fakeAutumn.locks.size).toBe(0);
    expect(await holds(t)).toEqual([]);
    // Settled, it has nothing more coming: its takeover went with it.
    expect(await coming(t)).toEqual([]);
  });

  it("is never confirmed for more than it holds, whatever its items came to", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    // Approved up to 100. Two items that were expected to fit cost 80 and 70.
    await hold(t, userId, "job:1", 100, true);
    await record(t, userId, 0, 80);
    await record(t, userId, 1, 70);

    await settle(t);
    // The person pays what they approved, and no separate charge takes the rest.
    expect(calls("balances.finalize").map((call) => call.body)).toEqual([{ lock_id: "job:1", action: "confirm", override_value: 100 }]);
    expect(calls("balances.track")).toHaveLength(0);
    expect(fakeAutumn.balance(userId)).toBe(900);
  });

  it("is given back whole when nothing was spent, and is settled with what was spent if it's still standing at its expiry", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "job:1", 200, true);
    await settle(t);
    expect(fakeAutumn.balance(userId)).toBe(1_000);
    expect(fakeAutumn.locks.size).toBe(0);

    // A job that never ends: its hold isn't released with its items uncharged.
    await hold(t, userId, "job:1", 200, true);
    await record(t, userId, 0, 70);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fakeAutumn.balance(userId)).toBe(930);
    expect(fakeAutumn.locks.size).toBe(0);
  });

  it("is settled once however often its job ends, and nothing that ends after that is charged", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "job:1", 200, true);
    await record(t, userId, 0, 60);

    // The job ended twice over (stopped, then cancelled): one confirm is scheduled, with the takeover behind it.
    await t.mutation(internal.billing.charge.settleSpent, { chargeId: "job:1", attempt: 0 });
    await t.mutation(internal.billing.charge.settleSpent, { chargeId: "job:1", attempt: 0 });
    expect((await coming(t)).sort()).toEqual(["confirmSpent", "settleSpent"]);

    // A paper that ends now isn't recorded under the hold, and isn't charged by itself either: the job costs what its one confirm takes.
    expect(await record(t, userId, 1, 90)).toBe(false);
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
    expect(await spent(t)).toEqual([60]);
    expect(calls("balances.track")).toHaveLength(0);
    expect(fakeAutumn.balance(userId)).toBe(940);
  });

  it("has one settling coming at any time: after its job ends, and again after a confirm that failed, which charges once", async () => {
    const t = convexTest(schema);
    const { userId } = await seedChat(t, 1_000);
    await hold(t, userId, "job:1", 200, true);
    await record(t, userId, 0, 60);
    // Its expiry, a day away.
    expect(await coming(t)).toEqual(["settleSpent"]);

    // The job stopped, and was cancelled before its hold was settled: one settling, a little after.
    await t.mutation(internal.billing.charge.laterSpent, { chargeId: "job:1", attempt: 0, delay: 30_000 });
    await t.mutation(internal.billing.charge.laterSpent, { chargeId: "job:1", attempt: 0, delay: 30_000 });
    expect(await coming(t)).toEqual(["settleSpent"]);
    // A paper whose cost is recorded in that time is still under the hold.
    expect(await record(t, userId, 1, 20)).toBe(true);

    // Autumn refuses the confirm: the hold stays, with its next try coming and nothing else.
    fakeAutumn.failNext = "balances.finalize";
    await settle(t);
    expect(await holds(t)).toHaveLength(1);
    expect(await coming(t)).toEqual(["settleSpent"]);
    expect(fakeAutumn.locks.size).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fakeAutumn.balance(userId)).toBe(920);
    expect(fakeAutumn.locks.size).toBe(0);
    expect(await holds(t)).toEqual([]);
    expect(await coming(t)).toEqual([]);
  });
});

describe("the usage ledger", () => {
  it("counts hundreds of charges for one extraction job within Convex's limits", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, transactionLimits: true });
      const { userId, jobId } = await seedChat(t, 10_000);
      for (let i = 0; i < 400; i += 100) {
        await t.run(async (ctx) => {
          for (let k = i; k < i + 100; k++) {
            await insertUsage(ctx, { userId, jobId, chargeId: `extraction:${k}`, credits: 1, kind: "extraction", description: "Extraction", createdAt: k });
          }
        });
      }

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await t.run((ctx) => creditsAgg.sum(ctx, { namespace: jobId }))).toBe(400);
      expect(await t.run(async (ctx) => (await ctx.db.query("billingUsage").collect()).filter((row) => row.queuedAt !== undefined).length)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);
});
