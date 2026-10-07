// The text each list's search index matches (#636): rows from before get it from the backfill,
// and an admin's follows their name.
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";

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
      await ctx.db.insert("queryShortcuts", { userId, data: { shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1 } });
      await ctx.db.insert("extractionJobs", { userId, name: "Tutoring review", sourceType: "history", status: "completed", totalPapers: 1, createdAt: 1, updatedAt: 1 });
    });
    const as = t.withIdentity({ subject: "admin" });
    const shortcuts = async () => (await as.query(api.research.records.listedShortcuts, { accountId: "admin", sort: "recent", text: "randomized", paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.shorthand);
    const jobs = async () => (await t.query(internal.extraction.queries.listJobsForAssistant, { userId, sort: "recent", text: "tutoring", paginationOpts: { cursor: null, numItems: 10 } })).page.map((job) => job.name);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
      await seedOrganizationFeatures(ctx, ["admin"], { extraction: true });
    });
    await t.mutation(internal.migrations.searchText.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await shortcuts()).toEqual(["rct"]);
    expect(await jobs()).toEqual(["Tutoring review"]);

    await t.run((ctx) => ctx.db.patch("users", userId, { firstName: "Grace" }));
    const admins = async (search: string) => (await as.query(api.admins.queries.listAdmins, { search, paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.email);
    expect(await admins("grace")).toEqual(["admin@test.local"]);
    expect(await admins("ada")).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
