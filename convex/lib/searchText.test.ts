// The text each list's search index matches (#636): rows from before get it from the backfill,
// and an admin's follows their name.
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { personalWorkspaceOf } from "../workspaces/actor";

it("the backfill makes rows from before findable, and an admin is found by the name they change to", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { clerkId: "admin", email: "admin@test.local", firstName: "Ada", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("admins", { email: "admin@test.local", userId: id, createdAt: 1 });
      return id;
    });
    // Rows from before, written without the triggers that keep their text.
    await runUntriggered(t, async (ctx) => {
      await ctx.db.insert("queryShortcuts", { workspaceId: await personalWorkspaceOf(ctx, userId), createdBy: userId, data: { shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1 } });
      await ctx.db.insert("extractionJobs", { workspaceId: await personalWorkspaceOf(ctx, userId), createdBy: userId, name: "Tutoring review", sourceType: "history", status: "completed", totalPapers: 1, createdAt: 1, updatedAt: 1 });
    });
    const as = t.withIdentity({ subject: "admin" });
    const shortcuts = async () => (await as.query(api.research.records.listedShortcuts, { accountId: "admin", sort: "recent", text: "randomized", paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.shorthand);
    const jobs = async () => (await t.query(internal.extraction.queries.listJobsForAssistant, { userId, sort: "recent", text: "tutoring", paginationOpts: { cursor: null, numItems: 10 } })).page.map((job) => job.name);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
      await seedOrganizationFeatures(ctx, ["admin"], { extraction: true });
    });
    expect(await t.action(internal.migrations.searchText.verify, {})).toBe(2);
    await t.mutation(internal.migrations.searchText.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.action(internal.migrations.searchText.verify, {})).toBe(0);
    expect(await shortcuts()).toEqual(["rct"]);
    expect(await jobs()).toEqual(["Tutoring review"]);

    await t.run((ctx) => ctx.db.patch("users", userId, { firstName: "Grace" }));
    const admins = async (search: string) => (await as.query(api.admins.queries.listAdmins, { search, paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.email);
    expect(await admins("grace")).toEqual(["admin@test.local"]);
    expect(await admins("ada")).toEqual([]);
    // A search of more words than the engine takes is cut to its first 16.
    expect(await admins(`grace ${"padding ".repeat(30)}`)).toEqual(["admin@test.local"]);

    // Once their user is deleted, an admin is found by email alone.
    await t.run((ctx) => ctx.db.delete("users", userId));
    expect(await t.run(async (ctx) => (await ctx.db.query("admins").first())?.searchText)).toBe("admin@test.local");
  } finally {
    vi.useRealTimers();
  }
});

it("a bookmark near Convex's document limit still saves, and is found by its first words", async () => {
  const t = convexTest(schema);
  await t.run((ctx) => ctx.db.insert("users", { clerkId: "big", email: "big@test.local", state: "active", createdAt: 1, updatedAt: 1 }));
  const as = t.withIdentity({ subject: "big" });
  const expansion = `malaria ${"x".repeat(600_000)}`;
  await as.mutation(api.research.records.change, { accountId: "big", requestId: "save", command: { kind: "shortcut", shorthand: "huge", value: { expansion, createdAt: 1 } } });
  const found = await as.query(api.research.records.listedShortcuts, { accountId: "big", sort: "recent", text: "malaria", paginationOpts: { cursor: null, numItems: 10 } });
  expect(found.page.map((row) => row.shorthand)).toEqual(["huge"]);
});
