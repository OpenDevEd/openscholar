import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest, accountOf, grantPlanFeaturesForTest } from "../billing/billing.test-support";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { BACKFILL_SPREAD_MS, REFRESH_DELAY_MS, backfillFrom } from "./suggestionRefresh";

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
  const finish = (dueAt: number, question: string, workspaceId = ids.home) => t.mutation(internal.research.suggestions.finishRefresh, { workspaceId, userId: ids.alice, dueAt, suggestions: [{ question, from: "q" }] });
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
    expect((await row())!.running).toBe(second);
    // A second job for the same refresh, as an import schedules, starts nothing.
    expect(await start(second)).toBeNull();
  });

  it("stores only the set of the run writing now, and dims the last set until that one finishes", async () => {
    const { asAlice, search, row, start, finish, home } = await setup();
    await search("teacher training");
    const first = (await row())!.dueAt!;
    await start(first);
    vi.advanceTimersByTime(REFRESH_DELAY_MS);
    await search("tutoring outcomes");
    const second = (await row())!.dueAt!;
    await start(second);
    // The first run finishing late neither stores its set nor ends the second.
    await finish(first, "From the first run?");
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: home })).toEqual({ suggestions: [], refreshing: true });
    await finish(second, "From the second run?");
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: home })).toEqual({ suggestions: [{ question: "From the second run?", from: "q" }], refreshing: false });
  });

  it("writes from a search asked something new however old it is", async () => {
    const { asAlice, search, row, start } = await setup();
    const { id } = await search("the oldest search");
    for (let n = 0; n < 10; n++) await search(`newer search ${n}`);
    await start((await row())!.dueAt!);
    await asAlice.mutation(api.research.searches.update, { id, changes: [{ setting: "query", value: "the oldest search, asked again" }] });
    const { searches } = (await start((await row())!.dueAt!))!;
    expect(searches[0]).toBe("the oldest search, asked again");
    expect(searches).toHaveLength(10);
  });

  it("leaves out a search moved to another workspace since it asked", async () => {
    const { t, search, row, start, team } = await setup();
    await search("teacher training");
    await search("a search that moves");
    const { askedBy, dueAt } = (await row())!;
    // Moved before the refresh runs (../workspaces/move.ts moves a search by its workspace).
    await t.run((ctx) => ctx.db.patch("searches", askedBy!, { workspaceId: team }));
    expect((await start(dueAt!))!.searches).toEqual(["teacher training"]);
  });

  it("writes no more sets a day than the workspace's plan allows, and keeps the last one past it", async () => {
    const { search, row, start, finish, setPerDay } = await setup();
    await setPerDay(2);
    for (const query of ["one", "two"]) {
      await search(query);
      const dueAt = (await row())!.dueAt!;
      expect(await start(dueAt)).not.toBeNull();
      await finish(dueAt, `After ${query}?`);
    }
    await search("three");
    expect(await start((await row())!.dueAt!)).toBeNull();
    expect(await row()).toMatchObject({ suggestions: [{ question: "After two?" }] });
    expect((await row())!.running).toBeUndefined();
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
    expect((await row())!.running).toBeUndefined();
  });

  it("shows each person in a workspace only their own set, and none of it in another workspace", async () => {
    const { t, asAlice, search, row, start, finish, team, home } = await setup();
    await search("teacher training", team);
    const dueAt = (await row(team))!.dueAt!;
    await start(dueAt, team);
    await finish(dueAt, "Which programmes work?", team);
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: team })).toEqual({ suggestions: [{ question: "Which programmes work?", from: "q" }], refreshing: false });
    expect(await t.withIdentity({ subject: "bob" }).query(api.research.suggestions.mine, { accountId: "bob", workspaceId: team })).toBeNull();
    expect(await asAlice.query(api.research.suggestions.mine, { accountId: "alice", workspaceId: home })).toBeNull();
  });

  it("backfills one refresh per person and workspace for searches made before suggestions, once however often it runs", async () => {
    const { t, search, team, home } = await setup();
    const asBob = t.withIdentity({ subject: "bob" });
    await search("one");
    await search("two");
    await search("three", team);
    await asBob.mutation(api.research.searches.create, { query: "bob's", workspaceId: team });
    // As if they were saved before suggested searches existed.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("searchSuggestions").collect()) await ctx.db.delete("searchSuggestions", row._id);
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.name.startsWith("research/suggestionsAction")) await ctx.scheduler.cancel(job._id);
    });
    const backfill = () => t.run(async (ctx) => { for (const row of await ctx.db.query("searches").collect()) await backfillFrom(ctx, row); });
    const queued = () => t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.startsWith("research/suggestionsAction") && job.state.kind === "pending"));
    await backfill();
    const rows = await t.run((ctx) => ctx.db.query("searchSuggestions").collect());
    expect(rows.map((row) => row.workspaceId).sort()).toEqual([home, team, team].sort());
    expect(rows.every((row) => row.dueAt! - Date.now() < BACKFILL_SPREAD_MS)).toBe(true);
    expect(await queued()).toHaveLength(3);
    await backfill();
    expect(await queued()).toHaveLength(3);
  });
});
