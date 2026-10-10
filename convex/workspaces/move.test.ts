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

it("takes a search's screenings with it, and leaves a search's screening to move with its search", async () => {
  const { t, alice, lab: labId, aliceOwn, users } = await lab();
  const { id } = await alice.mutation(api.research.searches.create, { query: "teacher coaching" });
  const job = await t.run(async (ctx) => {
    const search = (await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", aliceOwn).eq("localId", id)).unique())!;
    const screeningId = await ctx.db.insert("screenings", { workspaceId: aliceOwn, searchId: search._id, version: 0, createdAt: 1 });
    return ctx.db.insert("screeningJobs", { workspaceId: aliceOwn, createdBy: users.alice, screeningId, status: "completed", totalPapers: 4, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
  });
  expect(await alice.query(api.workspaces.move.held, { kind: "screening", id: job })).toMatch(/Move the search/);

  // One of its papers still being read holds the search back too.
  const paper = await t.run((ctx) => ctx.db.insert("screeningResults", { jobId: job, openalexId: "https://openalex.org/W1", title: "W1", authors: [], citedByCount: 0, status: "processing", createdAt: 1 }));
  expect(await alice.query(api.workspaces.move.held, { kind: "search", id })).toMatch(/still running/);
  await t.run((ctx) => ctx.db.patch("screeningResults", paper, { status: "completed" }));

  await alice.mutation(api.workspaces.move.move, { kind: "search", id, to: labId });
  expect((await t.run((ctx) => ctx.db.get("screeningJobs", job)))?.workspaceId).toBe(labId);
});

it("brings an item's activity to where it ends up when it moves back before its activity has", async () => {
  const { t, alice, lab: labId, aliceOwn } = await lab();
  const { id } = await alice.mutation(api.research.searches.create, { query: "teacher coaching" });
  await t.run(async (ctx) => {
    for (let n = 0; n < 450; n++) await ctx.db.insert("activity", { workspaceId: aliceOwn, item: `search:${id}`, by: (await ctx.db.query("users").first())!._id, happened: "rated", count: 1 });
  });
  await alice.mutation(api.workspaces.move.move, { kind: "search", id, to: labId });
  await alice.mutation(api.workspaces.move.move, { workspaceId: labId, kind: "search", id, to: aliceOwn });
  await t.finishAllScheduledFunctions(() => {});
  const where = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((row) => row.item === `search:${id}`).map((row) => row.workspaceId));
  expect(new Set(where)).toEqual(new Set([aliceOwn]));
});

it("moves a collection with its papers, saved to the library it goes to while the one it left keeps them", async () => {
  const { t, alice, lab: labId, aliceOwn } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { name: "Trials" });
  for (const n of [1, 2]) await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: `https://openalex.org/W${n}`, title: `Paper ${n}`, collectionId });
  const papers = (workspaceId: Id<"workspaces">) => t.run(async (ctx) => (await ctx.db.query("libraryItems").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()).map((item) => item.openalexId).sort());
  const collections = (workspaceId: Id<"workspaces">) => t.run(async (ctx) => (await ctx.db.query("collectionCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())?.count ?? 0);

  await alice.mutation(api.workspaces.move.move, { kind: "collection", id: collectionId, to: labId });
  await t.finishAllScheduledFunctions(() => {});

  expect((await t.run((ctx) => ctx.db.get("collections", collectionId)))?.workspaceId).toBe(labId);
  expect(await papers(labId)).toEqual(["https://openalex.org/W1", "https://openalex.org/W2"]);
  expect(await papers(aliceOwn)).toEqual(["https://openalex.org/W1", "https://openalex.org/W2"]);
  const places = await t.run(async (ctx) => Promise.all((await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).collect()).map(async (place) => (await ctx.db.get("libraryItems", place.libraryItemId))?.workspaceId)));
  expect(places).toEqual([labId, labId]);
  expect([await collections(aliceOwn), await collections(labId)]).toEqual([0, 1]);
});

it("keeps a collection where it is when the workspace it would go to has all its plan allows", async () => {
  const { t, alice, lab: labId } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { name: "Trials" });
  await t.run((ctx) => ctx.db.insert("billingAccounts", { workspaceId: labId, plan: "free_organization", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, limits: { collections: 0 }, refreshedAt: Date.now() }));
  await expect(alice.mutation(api.workspaces.move.move, { kind: "collection", id: collectionId, to: labId })).rejects.toThrow(/allows 0 collections/);
});

it("moves an author profile with its editors", async () => {
  const { t, alice, lab: labId, aliceOwn, users } = await lab();
  const profile = await t.run((ctx) => ctx.db.insert("authorProfiles", { name: "Ada", headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: "", workspaceId: aliceOwn, createdBy: users.alice, revision: 1, updatedAt: 1 }));
  await alice.mutation(api.workspaces.move.move, { kind: "author", id: profile, to: labId });
  expect((await t.run((ctx) => ctx.db.get("authorProfiles", profile)))?.workspaceId).toBe(labId);
});

it("moves a screening that stopped when its credits ran out, which has finished", async () => {
  const { t, alice, lab: labId, aliceOwn, users } = await lab();
  const job = await t.run(async (ctx) => {
    const screeningId = await ctx.db.insert("screenings", { workspaceId: aliceOwn, version: 0, createdAt: 1 });
    return ctx.db.insert("screeningJobs", { workspaceId: aliceOwn, createdBy: users.alice, screeningId, status: "creditsExhausted", totalPapers: 4, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
  });
  await alice.mutation(api.workspaces.move.move, { kind: "screening", id: job, to: labId });
  expect((await t.run((ctx) => ctx.db.get("screeningJobs", job)))?.workspaceId).toBe(labId);
});

it("keeps one place for a paper put in a moved collection before its papers have moved", async () => {
  const { t, alice, lab: labId } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { name: "Trials" });
  for (const n of [1, 2]) await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: `https://openalex.org/W${n}`, title: `Paper ${n}`, collectionId });
  await alice.mutation(api.workspaces.move.move, { kind: "collection", id: collectionId, to: labId });
  // Saved into it in the lab while its papers are still on their way.
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId: labId, openalexId: "https://openalex.org/W1", title: "Paper 1", collectionId });
  await t.finishAllScheduledFunctions(() => {});
  const places = await t.run((ctx) => ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).collect());
  expect(places).toHaveLength(2);
  expect((await t.run((ctx) => ctx.db.get("collections", collectionId)))?.itemCount).toBe(2);
});
