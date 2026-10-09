// The backfill that puts Evidence Libraries and author profiles from before workspaces in one (#650, slice 6).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { seedFeatureUser, seedOrganizationFeatures } from "../organizationFeatures.test-support";

it("puts each library in its organization's workspace, made by its creator, and each profile in its owner's own, however often it runs", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const { ada, team } = await t.run(async (ctx) => ({ ada: await seedFeatureUser(ctx, "ada"), team: await seedOrganizationFeatures(ctx, ["ada"], { evidenceLibraries: true }) }));
    // As they were before workspaces. One library's creator has no account here any more.
    const library = { organizationId: team, slug: "trials", state: "active" as const, updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 };
    const { kept, orphaned, profile } = await runUntriggered(t, async (ctx) => ({
      kept: await ctx.db.insert("evidenceLibraries", { ...library, name: "Trials", createdByClerkUserId: "ada" }),
      orphaned: await ctx.db.insert("evidenceLibraries", { ...library, name: "Old", slug: "old", createdByClerkUserId: "gone" }),
      profile: await ctx.db.insert("authorProfiles", { ownerId: ada, name: "Ada", headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: "", revision: 1, updatedAt: 1 }),
    }));
    expect(await t.action(internal.migrations.evidenceLibraryWorkspaces.verify, {})).toBe(3);
    for (let runs = 0; runs < 2; runs++) {
      await t.mutation(internal.migrations.evidenceLibraryWorkspaces.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await t.action(internal.migrations.evidenceLibraryWorkspaces.verify, {})).toBe(0);
    const rows = await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      return {
        lab: workspaces.find((workspace) => workspace.kind === "organization" && workspace.organizationId === team)?._id,
        own: workspaces.find((workspace) => workspace.kind === "personal" && workspace.userId === ada)?._id,
        kept: await ctx.db.get("evidenceLibraries", kept),
        orphaned: await ctx.db.get("evidenceLibraries", orphaned),
        profile: await ctx.db.get("authorProfiles", profile),
      };
    });
    expect(rows.kept).toMatchObject({ workspaceId: rows.lab, createdBy: ada, name: "Trials", organizationId: team });
    expect(rows.orphaned).toMatchObject({ workspaceId: rows.lab, name: "Old" });
    expect(rows.orphaned?.createdBy).toBeUndefined();
    expect(rows.profile).toMatchObject({ workspaceId: rows.own, createdBy: ada });
  } finally {
    vi.useRealTimers();
  }
});
