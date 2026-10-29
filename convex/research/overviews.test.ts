import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { accountOf, grantPlanFeaturesForTest, seedCreditsForTest } from "../billing/billing.test-support";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { PAID_PER_DAY } from "./overviews";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
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
    // The Cheap preset's chat model, which writes overviews.
    await ctx.db.insert("models", {
      modelId: "acme/cheap", name: "Cheap", provider: "acme", inputPricePerMillion: 1, outputPricePerMillion: 5,
      isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      supportedParameters: ["tools", "reasoning"], reasoningEfforts: ["low", "medium"], defaultEffort: "medium",
    });
    await ctx.db.insert("aiModelConfig", { key: "preset.cheap.chat", modelId: "acme/cheap", effort: "medium", updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId: alice });
    // An organization both are in, on its own plan.
    const team = await grantPlanFeaturesForTest(ctx, await seedOrganizationFeatures(ctx, ["alice", "bob"], {}), []);
    return { alice, bob, home: await personalWorkspaceOf(ctx, alice), team };
  });
  const as = (who: "alice" | "bob") => t.withIdentity({ subject: who });
  const scope = (who: "alice" | "bob", workspaceId: Id<"workspaces">) => ({ accountId: who, workspaceId });
  const search = async (query: string, workspaceId = ids.home) => (await as("alice").mutation(api.research.searches.create, { query, workspaceId })).id;
  const ensure = (searchId: string, args: { lens?: string; pay?: boolean; again?: boolean } = {}, workspaceId = ids.home) =>
    as("alice").mutation(api.research.overviews.ensure, { ...scope("alice", workspaceId), searchId, lens: args.lens ?? "overview", ...(args.pay ? { pay: true } : {}), ...(args.again ? { again: true } : {}) });
  const view = (who: "alice" | "bob" = "alice", workspaceId = ids.home) => as(who).query(api.research.overviews.view, scope(who, workspaceId));
  const stored = () => t.run((ctx) => ctx.db.query("searchOverviews").take(50));
  const setPerDay = (perDay: number | null) =>
    t.run(async (ctx) => {
      const account = await accountOf(ctx, ids.alice);
      await ctx.db.patch("billingAccounts", account!._id, { limits: { overviews_per_day: perDay } });
    });
  return { t, ...ids, as, scope, search, ensure, view, stored, setPerDay };
}

describe("AI overviews of a search", () => {
  it("writes the open lens free up to the plan's number a day, then waits to be asked for and paid", async () => {
    const { search, ensure, view, stored, setPerDay } = await setup();
    await setPerDay(2);
    const first = await search("teacher training");
    const second = await search("tutoring outcomes");
    const third = await search("school meals");
    expect(await ensure(first)).toBe("started");
    // Asked again while it runs, or once it's written, it isn't written or counted twice.
    expect(await ensure(first)).toBe("writing");
    expect(await ensure(second)).toBe("started");
    expect(await ensure(third)).toBe("ask");
    expect((await stored()).filter((row) => !row.paid)).toHaveLength(2);
    // Asked for with credits, it's written and counted as paid.
    expect(await ensure(third, { pay: true })).toBe("started");
    expect(await view()).toMatchObject({ day: "2026-10-29", free: 2, paid: 1, perDay: 2 });
    expect((await stored()).filter((row) => row.paid)).toHaveLength(1);
  });

  it("writes none free on a plan without them, and no more than PAID_PER_DAY paid ones a day, until the next day in UTC", async () => {
    const { search, ensure, view, setPerDay } = await setup();
    await setPerDay(0);
    const searches = [];
    for (let n = 0; n <= PAID_PER_DAY; n++) searches.push(await search(`search ${n}`));
    expect(await ensure(searches[0])).toBe("ask");
    for (const id of searches.slice(0, PAID_PER_DAY)) expect(await ensure(id, { pay: true })).toBe("started");
    expect(await ensure(searches[PAID_PER_DAY], { pay: true })).toBe("limit");
    vi.setSystemTime(new Date("2026-10-30T00:00:01Z"));
    expect(await ensure(searches[PAID_PER_DAY], { pay: true })).toBe("started");
    expect(await view()).toMatchObject({ day: "2026-10-30", free: 0, paid: 1 });
  });

  it("reads a written overview again for a search with the same request, and writes it anew only when asked", async () => {
    const { t, search, ensure, stored, setPerDay } = await setup();
    await setPerDay(5);
    const id = await search("teacher training");
    await ensure(id);
    const [row] = await stored();
    await t.mutation(internal.research.overviews.finishRun, { overviewId: row._id, text: "Written." });
    // Another search asking the same of OpenAlex reads the same overview.
    expect(await ensure(await search("teacher training"))).toBe("written");
    expect(await ensure(id, { again: true })).toBe("started");
    expect(await stored()).toHaveLength(1);
  });

  it("gives back the overview a failed run counted, and ends a run that never finishes", async () => {
    const { t, search, ensure, view, stored, setPerDay } = await setup();
    await setPerDay(1);
    const id = await search("teacher training");
    await ensure(id);
    const [row] = await stored();
    await t.mutation(internal.research.overviews.finishRun, { overviewId: row._id, error: "failed" });
    expect(await view()).toMatchObject({ free: 0 });
    // Tried again, it starts: the day's free one wasn't spent.
    expect(await ensure(id)).toBe("started");
    // A run that dies without ending is failed once its time is up, and only that run.
    const [running] = await stored();
    await t.mutation(internal.research.overviews.expire, { overviewId: running._id, startedAt: running.startedAt - 1 });
    expect((await stored())[0].status).toBe("running");
    await t.mutation(internal.research.overviews.expire, { overviewId: running._id, startedAt: running.startedAt });
    expect((await stored())[0]).toMatchObject({ status: "failed", error: "timeout" });
  });

  it("keeps a person's lenses theirs, shares one with the workspace, and lets others hide but not change it", async () => {
    const { as, scope, view, team } = await setup();
    const mine = await as("alice").mutation(api.research.overviews.saveLens, { ...scope("alice", team), name: "Funding", instruction: "Who funds this research.", shared: false });
    expect((await view("bob", team)).lenses.map((lens) => lens.id)).not.toContain(mine);
    const shared = await as("alice").mutation(api.research.overviews.saveLens, { ...scope("alice", team), name: "Methods", instruction: "Which study designs are used.", shared: true });
    // A new lens opens for who wrote it.
    expect((await view("alice", team)).open).toBe(shared);
    expect((await view("bob", team)).lenses.find((lens) => lens.id === shared)).toMatchObject({ name: "Methods", shared: true, mine: false });
    await expect(as("bob").mutation(api.research.overviews.saveLens, { ...scope("bob", team), id: shared, name: "Mine now", instruction: "Anything.", shared: true })).rejects.toThrow();
    // Taken off Bob's list, it's still on Alice's; the built-in Overview lens can't be taken off.
    await as("bob").mutation(api.research.overviews.removeLens, { ...scope("bob", team), id: shared });
    expect((await view("bob", team)).lenses.map((lens) => lens.id)).not.toContain(shared);
    expect((await view("alice", team)).lenses.map((lens) => lens.id)).toContain(shared);
    await expect(as("bob").mutation(api.research.overviews.removeLens, { ...scope("bob", team), id: "overview" })).rejects.toThrow();
    // Edited, its version moves on, so an overview written for the old words isn't shown for the new ones.
    await as("alice").mutation(api.research.overviews.saveLens, { ...scope("alice", team), id: shared, name: "Methods", instruction: "Which study designs, and how large.", shared: true });
    expect((await view("alice", team)).lenses.find((lens) => lens.id === shared)).toMatchObject({ version: 2, instruction: "Which study designs, and how large." });
  });

  it("keeps folded and the open lens per person, and refuses a lens that isn't on their list", async () => {
    const { as, scope, view, home } = await setup();
    await as("alice").mutation(api.research.overviews.setView, { ...scope("alice", home), open: "trend", collapsed: true });
    expect(await view()).toMatchObject({ open: "trend", collapsed: true });
    await expect(as("alice").mutation(api.research.overviews.setView, { ...scope("alice", home), open: "someone-elses" })).rejects.toThrow();
  });
});
