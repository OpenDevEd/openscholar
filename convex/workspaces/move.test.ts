// Moving an item to another of the person's workspaces (#654): it goes with its activity and counts, and
// only an organization's admins move its work out; a running job and someone else's chat stay.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ensureWorkspace } from "./create";
import { personalWorkspaceOf } from "./personal";

/** Alice, an admin of the lab, and Bob, a member. */
async function lab() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const [clerkUserId, role] of [["alice", "org:admin"], ["bob", "org:member"]] as const) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    return { users, lab: await ensureWorkspace(ctx, { kind: "organization", organizationId }), aliceOwn: await personalWorkspaceOf(ctx, users.alice), bobOwn: await personalWorkspaceOf(ctx, users.bob) };
  });
  const [alice, bob] = ["alice", "bob"].map((subject) => t.withIdentity({ subject }));
  /** How many searches a workspace counts, in all and made by `by`. */
  const searches = (workspaceId: Id<"workspaces">, by?: Id<"users">) =>
    t.run(async (ctx) => (await ctx.db.query("recordCounts").withIndex("by_workspace_and_table_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("table", "searches").eq("createdBy", by)).unique())?.count ?? 0);
  return { t, alice, bob, searches, ...seeded };
}

it("moves a search into an organization with its answers, counts and activity, and the activity says where it came from", async () => {
  const { t, alice, searches, users, lab: labId, aliceOwn } = await lab();
  const { id } = await alice.mutation(api.research.searches.create, { query: "teacher coaching" });
  // A workspace's first count is taken a page at a time.
  await t.finishAllScheduledFunctions(() => {});
  expect([await searches(aliceOwn), await searches(labId)]).toEqual([1, 0]);

  await alice.mutation(api.workspaces.move.move, { kind: "search", id, to: labId });
  await t.finishAllScheduledFunctions(() => {});

  const search = await t.run((ctx) => ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", labId).eq("localId", id)).unique());
  expect(search).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.query("screenings").withIndex("by_search", (q) => q.eq("searchId", search!._id)).collect())).toSatisfy((rows: Array<{ workspaceId: Id<"workspaces"> }>) => rows.every((row) => row.workspaceId === labId));
  expect([await searches(aliceOwn), await searches(labId), await searches(labId, users.alice)]).toEqual([0, 1, 1]);
  const activity = (await alice.query(api.activity.queries.list, { workspaceId: labId, kind: "search", id, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(activity.map(({ happened, detail }) => ({ happened, detail }))).toEqual([
    { happened: "moved", detail: "Alice" },
    { happened: "created", detail: "teacher coaching" },
  ]);
});

it("leaves an organization's work where it is for a member, and a running job until it has finished", async () => {
  const { t, alice, bob, lab: labId, bobOwn, users } = await lab();
  const { id } = await alice.mutation(api.research.searches.create, { workspaceId: labId, query: "phonics" });
  expect(await bob.query(api.workspaces.move.held, { workspaceId: labId, kind: "search", id })).toMatch(/admins/);
  await expect(bob.mutation(api.workspaces.move.move, { workspaceId: labId, kind: "search", id, to: bobOwn })).rejects.toThrow(/admins/);
  // Nowhere the person isn't in.
  await expect(alice.mutation(api.workspaces.move.move, { workspaceId: labId, kind: "search", id, to: bobOwn })).rejects.toThrow(/not found/i);

  const job = await t.run(async (ctx) => {
    const screeningId = await ctx.db.insert("screenings", { workspaceId: labId, version: 0, createdAt: 1 });
    return ctx.db.insert("screeningJobs", { workspaceId: labId, createdBy: users.alice, screeningId, status: "processing", totalPapers: 4, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
  });
  const aliceOwn = await t.run((ctx) => personalWorkspaceOf(ctx, users.alice));
  await expect(alice.mutation(api.workspaces.move.move, { workspaceId: labId, kind: "screening", id: job, to: aliceOwn })).rejects.toThrow(/once it has finished/);
  await t.run((ctx) => ctx.db.patch("screeningJobs", job, { status: "completed" }));
  await alice.mutation(api.workspaces.move.move, { workspaceId: labId, kind: "screening", id: job, to: aliceOwn });
  expect((await t.run((ctx) => ctx.db.get("screeningJobs", job)))?.workspaceId).toBe(aliceOwn);
});
