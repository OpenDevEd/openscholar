// Approved OpenAlex query versions stay fixed without reading every revision (#357).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { assertApprovedQueriesUnchanged } from "./approvedQueries";

const sources = (version: string, search: string) => [{ provider: "openalex", settings: { approvedQuery: { version, approvedAt: "2026-01-01T00:00:00.000Z", query: { search } } } }];

async function libraryWithSources(revisions = 1) {
  const fixture = await createReadySetupFixture(`approved_${Math.random().toString(36).slice(2, 8)}`);
  const libraryId = fixture.created.libraryId;
  await fixture.t.run(async (ctx) => {
    const { _id, _creationTime, ...template } = (await ctx.db.query("evidenceLibraryConfigSections").withIndex("by_libraryId_and_kind_and_sectionKey", (q) => q.eq("libraryId", libraryId).eq("kind", "revision").eq("sectionKey", "identity")).first())!;
    for (let i = 0; i < revisions; i++) await ctx.db.insert("evidenceLibraryConfigSections", { ...template, sectionKey: "sources", payload: sources("v1", "climate") });
    // A library saved before versions were recorded.
    await ctx.db.patch("evidenceLibraries", libraryId, { approvedQueriesRecorded: undefined });
  });
  const check = (proposed: unknown) => fixture.t.run(async (ctx) => assertApprovedQueriesUnchanged(ctx, (await ctx.db.get("evidenceLibraries", libraryId))!, proposed));
  const recorded = () => fixture.t.run((ctx) => ctx.db.query("evidenceLibraryApprovedQueries").withIndex("by_libraryId_and_version", (q) => q.eq("libraryId", libraryId as Id<"evidenceLibraries">)).collect());
  return { fixture, libraryId, check, recorded };
}

describe("approved OpenAlex query versions", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("are recorded when a sources revision is saved, and a recorded library checks only them", async () => {
    const { fixture, libraryId, check, recorded } = await libraryWithSources();
    expect((await recorded()).map((row) => row.version)).toEqual(["v1"]);
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { approvedQueriesRecorded: true }));
    await check(sources("v1", "climate"));
    await check(sources("v2", "anything"));
    await expect(check(sources("v1", "changed"))).rejects.toThrow(/cannot be changed/);
    await expect(check([...sources("v3", "a"), ...sources("v3", "b")])).rejects.toThrow(/cannot be changed/);
  });

  it("are checked against the revisions while a library isn't recorded yet", async () => {
    const { fixture, check, recorded } = await libraryWithSources();
    await fixture.t.run(async (ctx) => { for (const row of await ctx.db.query("evidenceLibraryApprovedQueries").collect()) await ctx.db.delete(row._id); });
    expect(await recorded()).toHaveLength(0);
    await expect(check(sources("v1", "changed"))).rejects.toThrow(/cannot be changed/);
  });

  it("are recorded for older libraries by the migration, which says when it's done", async () => {
    vi.useFakeTimers();
    try {
      // More revisions than a library not yet recorded reads in one save.
      const { fixture, libraryId, recorded } = await libraryWithSources(400);
      await fixture.t.run(async (ctx) => { for (const row of await ctx.db.query("evidenceLibraryApprovedQueries").collect()) await ctx.db.delete(row._id); });
      expect(await fixture.t.action(internal.migrations.recordApprovedQueries.verify, {})).toContain(libraryId);
      await fixture.t.mutation(internal.migrations.recordApprovedQueries.run, {});
      await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await fixture.t.action(internal.migrations.recordApprovedQueries.verify, {})).toEqual([]);
      expect((await recorded()).map((row) => row.version)).toEqual(["v1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
