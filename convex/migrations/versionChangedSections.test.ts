// The backfill that records, on versions made before they recorded it themselves (#423), the sections each one changed.
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

it("names what each earlier version changed, as a version recorded now does, however often it runs", async () => {
  vi.useFakeTimers();
  try {
    const fixture = await createReadySetupFixture("version_changes");
    const libraryId = fixture.created.libraryId;
    const changes = async () =>
      (await fixture.admin.query(api.evidenceLibraries.versions.listVersionRows, { libraryId, paginationOpts: { cursor: null, numItems: 10 } })).page.map((version) => version.changedSections);
    // What the versions recorded when they were made.
    const recorded = await changes();
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((sections) => sections.length > 0)).toBe(true);
    expect(await fixture.t.action(internal.migrations.versionChangedSections.verify, {})).toBe(0);

    // As versions made before: the same operations with nothing recorded, each keeping its
    // deployment's encrypted configuration at close to the largest a row may hold.
    await fixture.t.run(async (ctx) => {
      const runtimeBindingId = (await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first())!._id;
      const target = { applicationId: "application", aiProviderKey: { present: false as const }, openAlexApiKey: { present: false as const }, runtimeBindingId, targetBaseUrl: "https://library.example.test", customDomains: [], revisionKey: "r1", defaultLocale: "en-GB", runtimeCommit: "a".repeat(40), runtimeImage: "runtime:test", encryptedRuntimeConfig: "x".repeat(900_000), runtimeConfigSha256: "b".repeat(64), savedAt: 1 };
      const operations = await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_createdAt", (q) => q.eq("libraryId", libraryId)).take(20);
      for (const operation of operations) await ctx.db.patch(operation._id, { changedSections: undefined, configurationDeploymentTarget: target });
    });
    expect(await fixture.t.action(internal.migrations.versionChangedSections.verify, {})).toBe(recorded.length);
    expect(await changes()).toEqual(recorded.map(() => []));

    for (let runs = 0; runs < 2; runs++) {
      await fixture.t.mutation(internal.migrations.versionChangedSections.run, {});
      await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await fixture.t.action(internal.migrations.versionChangedSections.verify, {})).toBe(0);
    expect(await changes()).toEqual(recorded);
  } finally {
    vi.useRealTimers();
  }
});
