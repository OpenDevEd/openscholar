import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest, accountOf, grantPlanFeaturesForTest } from "../billing/billing.test-support";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { REFRESH_DELAY_MS } from "./suggestionRefresh";

beforeEach(() => {
  vi.useFakeTimers();
  // A new search is counted against OpenAlex in the background; nothing here waits for it.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ meta: { count: 1 }, results: [] }), { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const [alice, bob] = await Promise.all(["alice", "bob"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.com`, state: "active", createdAt: 1, updatedAt: 1 })));
    // The Cheap preset's question writer, which takes reasoning from none upward.
    await ctx.db.insert("models", {
      modelId: "acme/cheap", name: "Cheap", provider: "acme", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5,
      isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      supportedParameters: ["structured_outputs", "reasoning"], reasoningEfforts: ["none", "low", "medium"], defaultEffort: "medium",
    });
    await ctx.db.insert("aiModelConfig", { key: "preset.cheap.questionToQuery", modelId: "acme/cheap", effort: "medium", updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId: alice });
    // An organization both are in, on its own plan.
    const team = await grantPlanFeaturesForTest(ctx, await seedOrganizationFeatures(ctx, ["alice", "bob"], {}), []);
    return { alice, bob, home: await personalWorkspaceOf(ctx, alice), team };
  });
  const asAlice = t.withIdentity({ subject: "alice" });
  const search = (query: string, workspaceId?: Id<"workspaces">) => asAlice.mutation(api.research.searches.create, { query, ...(workspaceId && { workspaceId }) });
  const row = (workspaceId = ids.home) => t.run((ctx) => ctx.db.query("searchSuggestions").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", ids.alice)).unique());
  const start = (dueAt: number, workspaceId = ids.home) => t.mutation(internal.research.suggestions.startRefresh, { workspaceId, userId: ids.alice, dueAt });
  const finish = (question: string, workspaceId = ids.home) => t.mutation(internal.research.suggestions.finishRefresh, { workspaceId, userId: ids.alice, suggestions: [{ question, from: "q" }] });
  const setPerDay = (perDay: number) => t.run(async (ctx) => {
    const account = await accountOf(ctx, ids.alice);
    await ctx.db.patch("billingAccounts", account!._id, { limits: { suggestions_per_day: perDay } });
  });
  return { t, ...ids, asAlice, search, row, start, finish, setPerDay };
}

describe("suggested searches", () => {
  it("asks for a set a minute after a search, and searches closer together than that ask once", async () => {
    const { search, row, start } = await setup();
    await search("teacher training");
    const first = (await row())!.dueAt!;
    expect(first - Date.now()).toBe(REFRESH_DELAY_MS);
    vi.advanceTimersByTime(20_000);
    await search("tutoring outcomes");
    const second = (await row())!.dueAt!;
    expect(second).toBeGreaterThan(first);
    // The first run finds a later search moved the refresh, and writes nothing.
    expect(await start(first)).toBeNull();
    // The second writes from both, newest first, at the model's lowest effort.
    expect(await start(second)).toEqual({ searches: ["tutoring outcomes", "teacher training"], modelId: expect.any(String), effort: "none" });
    expect((await row())!.generating).toBe(true);
  });

  it("writes no more sets a day than the workspace's plan allows, and keeps the last one past it", async () => {
    const { search, row, start, finish, setPerDay } = await setup();
    await setPerDay(2);
    for (const query of ["one", "two"]) {
      await search(query);
      expect(await start((await row())!.dueAt!)).not.toBeNull();
      await finish(`After ${query}?`);
    }
    await search("three");
    expect(await start((await row())!.dueAt!)).toBeNull();
    expect(await row()).toMatchObject({ generating: false, suggestions: [{ question: "After two?" }] });
    // A day later the plan's number is back.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await search("four");
    expect(await start((await row())!.dueAt!)).not.toBeNull();
  });

  it("writes none on a plan that sets the number to 0", async () => {
    const { search, row, start, setPerDay } = await setup();
    await setPerDay(0);
    await search("teacher training");
    expect(await start((await row())!.dueAt!)).toBeNull();
    expect((await row())!.generating).toBe(false);
  });

  it("shows each person in a workspace only their own set, and none of it in another workspace", async () => {
    const { t, asAlice, search, row, start, finish, team, home } = await setup();
    await search("teacher training", team);
    await start((await row(team))!.dueAt!, team);
    await finish("Which programmes work?", team);
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: team })).toEqual({ suggestions: [{ question: "Which programmes work?", from: "q" }], refreshing: false });
    expect(await t.withIdentity({ subject: "bob" }).query(api.research.suggestions.mine, { accountId: "bob", workspaceId: team })).toBeNull();
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: home })).toBeNull();
  });
});
