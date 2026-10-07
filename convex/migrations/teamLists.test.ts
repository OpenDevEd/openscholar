// The team backfill (#637): grants from before are counted under their library and person, and
// members from before get the text the team picker searches.
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { runUntriggered } from "../../tests/convex-test-with-limits";

it("counts grants and fills members from before, once however often it runs", async () => {
  vi.useFakeTimers();
  try {
    const fixture = await createReadySetupFixture("team_backfill");
    const libraryId = fixture.created.libraryId;
    await runUntriggered(fixture.t, async (ctx) => {
      const { organizationId } = (await ctx.db.get("evidenceLibraries", libraryId))!;
      await ctx.db.insert("users", { clerkId: "user_old", email: "old@example.org", firstName: "Hedy", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "orgmem_old", clerkUserId: "user_old", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("evidenceLibraryMembers", { libraryId, clerkUserId: "user_granted", role: "editor", grantedBy: "owner", grantedAt: 1 });
    });
    expect(await fixture.t.action(internal.migrations.teamLists.verify, {})).toBeGreaterThan(0);
    for (let runs = 0; runs < 2; runs++) {
      await fixture.t.mutation(internal.migrations.teamLists.run, {});
      await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await fixture.t.action(internal.migrations.teamLists.verify, {})).toBe(0);
    const found = await fixture.admin.query(api.evidenceLibraries.queries.listOrganizationPeople, { libraryId, search: "hedy", paginationOpts: { cursor: null, numItems: 10 } });
    expect(found.page.map((person) => person.clerkUserId)).toEqual(["user_old"]);
  } finally {
    vi.useRealTimers();
  }
});
