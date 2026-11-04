import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { FREE_QUESTIONS_FLAG } from "../../lib/ai/free-queries";

async function setup(models = ["anthropic/claude-haiku-5.5", "acme/other"]) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const rows = await Promise.all(models.map((modelId) => ctx.db.insert("models", {
      modelId, name: modelId, provider: "acme", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5,
      isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      supportedParameters: ["structured_outputs", "reasoning"], reasoningEfforts: ["none", "low", "medium"], defaultEffort: "medium",
    })));
    return { rows };
  });
  const limits = (fields: { perAddress?: number; perPerson?: number; signedOutPerDay?: number; signedInPerDay?: number }) =>
    t.run((ctx) => ctx.db.insert("freeQuerySettings", { modelId: "anthropic/claude-haiku-5.5", effort: "none", perAddress: 50, perPerson: 200, signedOutPerDay: 1000, signedInPerDay: 1000, updatedAt: 1, ...fields }));
  const claim = (who: { person: string } | { address: string }) => t.mutation(internal.ai.freeQueries.claim, { who });
  return { t, ...ids, limits, claim };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("free writing of queries from questions", () => {
  it("gives a day's total once, and all of it again the next UTC day", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 4, 0, 5) });
    const { claim, limits } = await setup();
    await limits({ signedOutPerDay: 2, perAddress: 100 });
    expect((await claim({ address: "a" })).kind).toBe("go");
    expect((await claim({ address: "b" })).kind).toBe("go");
    expect((await claim({ address: "c" })).kind).toBe("limit");
    // Twelve hours on, a bucket would have refilled by half.
    vi.setSystemTime(Date.UTC(2026, 10, 4, 12, 5));
    expect((await claim({ address: "c" })).kind).toBe("limit");
    vi.setSystemTime(Date.UTC(2026, 10, 5, 0, 1));
    expect((await claim({ address: "c" })).kind).toBe("go");
    expect((await claim({ address: "d" })).kind).toBe("go");
    expect((await claim({ address: "e" })).kind).toBe("limit");
  });

  it("applies a raised total today, by exactly the rise", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 4, 9) });
    const { t, claim, limits } = await setup();
    await limits({ signedOutPerDay: 1 });
    expect((await claim({ address: "a" })).kind).toBe("go");
    expect((await claim({ address: "b" })).kind).toBe("limit");
    await t.run(async (ctx) => {
      const user = await ctx.db.insert("users", { clerkId: "owner", email: "owner@test.dev", state: "active" as const, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("admins", { email: "owner@test.dev", userId: user, createdAt: 1 });
    });
    await t.withIdentity({ subject: "owner" }).mutation(api.ai.freeQueries.setLimits, { perAddress: 50, perPerson: 200, signedOutPerDay: 3, signedInPerDay: 1000 });
    expect((await claim({ address: "b" })).kind).toBe("go");
    expect((await claim({ address: "c" })).kind).toBe("go");
    expect((await claim({ address: "d" })).kind).toBe("limit");
  });

  it("runs on Haiku with reasoning off until an admin changes it", async () => {
    const { claim, rows } = await setup();
    await expect(claim({ address: "a" })).resolves.toEqual({ kind: "go", modelId: rows[0], effort: "none" });
  });

  it("holds each address to its own limit, and leaves other addresses alone", async () => {
    const { claim, limits } = await setup();
    await limits({ perAddress: 2 });
    expect((await claim({ address: "a" })).kind).toBe("go");
    expect((await claim({ address: "a" })).kind).toBe("go");
    expect((await claim({ address: "a" })).kind).toBe("limit");
    expect((await claim({ address: "b" })).kind).toBe("go");
  });

  it("holds each signed-in person to their own limit", async () => {
    const { claim, limits } = await setup();
    await limits({ perPerson: 1 });
    expect((await claim({ person: "p" })).kind).toBe("go");
    expect((await claim({ person: "p" })).kind).toBe("limit");
    expect((await claim({ person: "q" })).kind).toBe("go");
  });

  it("keeps the day's totals apart, so signed-out traffic can't use up signed-in people's", async () => {
    const { claim, limits } = await setup();
    await limits({ signedOutPerDay: 1, signedInPerDay: 1 });
    expect((await claim({ address: "a" })).kind).toBe("go");
    expect((await claim({ address: "b" })).kind).toBe("limit");
    expect((await claim({ person: "p" })).kind).toBe("go");
    expect((await claim({ person: "q" })).kind).toBe("limit");
  });

  it("doesn't let someone over their own limit use up the day's total", async () => {
    const { claim, limits } = await setup();
    await limits({ perAddress: 1, signedOutPerDay: 2 });
    expect((await claim({ address: "a" })).kind).toBe("go");
    for (let i = 0; i < 5; i++) expect((await claim({ address: "a" })).kind).toBe("limit");
    expect((await claim({ address: "b" })).kind).toBe("go");
  });

  it("stops when the switch is off", async () => {
    const { t, claim } = await setup();
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: FREE_QUESTIONS_FLAG, enabled: false, description: "x", updatedAt: 1 }));
    await expect(claim({ address: "a" })).resolves.toEqual({ kind: "off" });
  });

  it("says the model is unavailable rather than running something else", async () => {
    const { claim } = await setup(["acme/other"]);
    await expect(claim({ address: "a" })).resolves.toEqual({ kind: "unavailable" });
  });

  it("adds a day's calls and cost up by audience", async () => {
    const { t } = await setup();
    const record = (audience: "signedIn" | "signedOut", costUsd: number, failed = false) => t.mutation(internal.ai.freeQueries.record, { audience, day: "2026-11-04", costUsd, failed });
    await record("signedOut", 0.25);
    await record("signedOut", 0.5);
    await record("signedOut", 0, true);
    await record("signedIn", 0.1);
    const days = await t.run((ctx) => ctx.db.query("freeQueryDays").collect());
    expect(days.find((day) => day.audience === "signedOut")).toMatchObject({ calls: 3, failed: 1, costUsd: 0.75 });
    expect(days.find((day) => day.audience === "signedIn")).toMatchObject({ calls: 1, failed: 0, costUsd: 0.1 });
  });

  it("refuses the settings to anyone who isn't an admin", async () => {
    const { t, rows } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "someone", email: "someone@test.dev", state: "active" as const, createdAt: 1, updatedAt: 1 }));
    const someone = t.withIdentity({ subject: "someone" });
    await expect(someone.query(api.ai.freeQueries.settings, { day: "2026-11-04" })).rejects.toThrow();
    await expect(someone.mutation(api.ai.freeQueries.setPick, { modelId: rows[1]! })).rejects.toThrow();
    await expect(someone.mutation(api.ai.freeQueries.setLimits, { perAddress: 1, perPerson: 1, signedOutPerDay: 1, signedInPerDay: 1 })).rejects.toThrow();
  });

  it("refuses the action without the shared secret, before anything runs", async () => {
    const { t } = await setup();
    await expect(t.action(api.ai.freeQueriesAction.write, { secret: "wrong", who: { address: "a" }, question: "q" })).rejects.toThrow();
    await expect(t.run((ctx) => ctx.db.query("freeQueryDays").first())).resolves.toBeNull();
  });
});
