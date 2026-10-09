// Clearing who Evidence Libraries and author profiles belonged to before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { organizationWorkspaceOf } from "../workspaces/personal";

it("clears a library's organization and a profile's owner, keeps their workspace and maker, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const { ada, organizationId } = await t.run(async (ctx) => ({
      ada: await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }),
      organizationId: await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: true, authorsEnabled: true, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 }),
    }));
    const workspaceId = await t.run((ctx) => organizationWorkspaceOf(ctx, organizationId));
    await runUntriggered(t, async (ctx) => {
      await ctx.db.insert("evidenceLibraries", { organizationId, workspaceId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("authorProfiles", { name: "Ada", headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: "", ownerId: ada, workspaceId, createdBy: ada, revision: 1, updatedAt: 1 });
    });
    expect(await t.action(internal.migrations.narrowLibraries.verify, {})).toBe(2);
    const rows = () => t.run(async (ctx) => [...(await ctx.db.query("evidenceLibraries").collect()), ...(await ctx.db.query("authorProfiles").collect())]);
    await t.mutation(internal.migrations.narrowLibraries.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(once.every((row) => !("organizationId" in row) && !("ownerId" in row))).toBe(true);
    expect(once).toMatchObject([{ workspaceId }, { workspaceId, createdBy: ada }]);
    await t.mutation(internal.migrations.narrowLibraries.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowLibraries.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
