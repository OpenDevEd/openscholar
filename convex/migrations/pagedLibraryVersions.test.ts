// The backfill that counts the versions libraries had before their Versions section paged (#423).
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { runUntriggered } from "../../tests/convex-test-with-limits";

it("counts the versions recorded before, once however often it runs, and leaves other operations out", async () => {
  vi.useFakeTimers();
  try {
    const fixture = await createReadySetupFixture("paged_versions");
    const libraryId = fixture.created.libraryId;
    const count = () => fixture.admin.query(api.evidenceLibraries.versions.countVersions, { libraryId });
    const counted = await count();
    // As operations recorded before the count: two more versions and one operation that isn't a version, written without the trigger.
    await runUntriggered(fixture.t, async (ctx) => {
      const operation = (await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_createdAt", (q) => q.eq("libraryId", libraryId)).first())!;
      const { _id, _creationTime, ...fields } = operation;
      for (const key of ["before-1", "before-2"]) await ctx.db.insert("evidenceLibraryConfigOperations", { ...fields, kind: "publish", activationEditVersion: 1, idempotencyKey: key });
      await ctx.db.insert("evidenceLibraryConfigOperations", { ...fields, kind: "publish", activationEditVersion: undefined, idempotencyKey: "not-a-version" });
    });
    expect(await fixture.t.action(internal.migrations.pagedLibraryVersions.verify, {})).toBe(2);
    expect(await count()).toBe(counted);

    for (let runs = 0; runs < 2; runs++) {
      await fixture.t.mutation(internal.migrations.pagedLibraryVersions.run, {});
      await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await fixture.t.action(internal.migrations.pagedLibraryVersions.verify, {})).toBe(0);
    expect(await count()).toBe(counted + 2);
  } finally {
    vi.useRealTimers();
  }
});
