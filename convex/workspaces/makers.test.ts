// A list's Run by (#656): each member's count of what they made in an organization, and lists of one member's.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ensureWorkspace } from "./create";

// A member's first count is taken in steps of its own, which these tests let finish.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Alice and Bob in a lab. */
async function lab() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const clerkUserId of ["alice", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    return { users, workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId }), aliceOwn: await ensureWorkspace(ctx, { kind: "personal", userId: users.alice }) };
  });
  const [alice, bob] = ["alice", "bob"].map((subject) => t.withIdentity({ subject }));
  return { t, alice, bob, settled: () => t.finishAllScheduledFunctions(vi.runAllTimers), ...seeded };
}

const page = { paginationOpts: { cursor: null, numItems: 20 } };

it("counts what each member made, keeps the counts as they make and delete, and lists one member's", async () => {
  const { alice, bob, settled, users, workspaceId } = await lab();
  const counts = async () => Object.fromEntries((await alice.query(api.workspaces.makers.counts, { workspaceId, table: "collections", ...page })).page.map((row) => [row.name, row.count]));
  const { id: trials } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Reviews" });
  await bob.mutation(api.library.collections.createCollection, { workspaceId, name: "Coaching" });
  await settled();
  expect(await counts()).toEqual({ Alice: 2, Bob: 1 });

  // Bob's list is his alone, and names him.
  const bobs = (await alice.query(api.library.collections.listCollections, { workspaceId, by: users.bob, ...page })).page;
  expect(bobs.map((row) => [row.name, row.by?.name])).toEqual([["Coaching", "Bob"]]);

  await alice.mutation(api.library.collections.deleteCollection, { workspaceId, collectionId: trials });
  await settled();
  expect(await counts()).toEqual({ Alice: 1, Bob: 1 });
});

it("counts no one in a person's own workspace, where everything is theirs", async () => {
  const { alice, settled, aliceOwn } = await lab();
  await alice.mutation(api.library.collections.createCollection, { workspaceId: aliceOwn, name: "Mine" });
  await settled();
  expect((await alice.query(api.workspaces.makers.counts, { workspaceId: aliceOwn, table: "collections", ...page })).page).toEqual([]);
  expect((await alice.query(api.library.collections.listCollections, { workspaceId: aliceOwn, ...page })).page[0]).not.toHaveProperty("by");
});

it("lists you first, and keeps a member who left, last, and in the organization's total", async () => {
  const { t, alice, bob, settled, workspaceId } = await lab();
  await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await bob.mutation(api.library.collections.createCollection, { workspaceId, name: "Coaching" });
  await settled();
  const names = async (as: typeof alice) => (await as.query(api.workspaces.makers.counts, { workspaceId, table: "collections", ...page })).page.map((row) => row.name);
  expect(await names(bob)).toEqual(["Bob", "Alice"]);
  expect(await names(alice)).toEqual(["Alice", "Bob"]);

  // Bob leaves; his collection stays the organization's, and so does he in its filter, last.
  await t.run(async (ctx) => {
    const membership = await ctx.db.query("organizationMemberships").filter((q) => q.eq(q.field("clerkUserId"), "bob")).first();
    await ctx.db.patch("organizationMemberships", membership!._id, { state: "revoked" });
  });
  expect(await names(alice)).toEqual(["Alice", "Bob"]);
  expect(await alice.query(api.workspaces.makers.total, { workspaceId, table: "collections" })).toBe(2);
});

it("an organization's bookmarks name who added each, list one member's, and are changed by that member alone", async () => {
  const { alice, bob, settled, users, workspaceId } = await lab();
  const people = { alice, bob };
  const set = (accountId: "alice" | "bob", shorthand: string, expansion: string | null) =>
    people[accountId].mutation(api.research.records.change, { accountId, workspaceId, requestId: `${accountId}-${shorthand}-${expansion}`, command: { kind: "shortcut", shorthand, value: expansion === null ? null : { expansion, createdAt: 1 } } });
  await set("alice", "ai", "artificial intelligence");
  await set("bob", "edu", "education OR schooling");
  await settled();
  const listed = async (by?: Id<"users">) => (await alice.query(api.research.records.listedShortcuts, { accountId: "alice", workspaceId, sort: "alpha", ...(by ? { by } : {}), ...page })).page.map((row) => [row.shorthand, row.by?.name, row.by?.you]);
  expect(await listed()).toEqual([["ai", "Alice", true], ["edu", "Bob", false]]);
  expect(await listed(users.bob)).toEqual([["edu", "Bob", false]]);
  expect(Object.fromEntries((await alice.query(api.workspaces.makers.counts, { workspaceId, table: "queryShortcuts", ...page })).page.map((row) => [row.name, row.count]))).toEqual({ Alice: 1, Bob: 1 });

  // Bob, a member, uses Alice's bookmark but neither rewrites nor removes it.
  await expect(set("bob", "ai", "something else")).rejects.toThrow(/Only an admin/);
  await expect(set("bob", "ai", null)).rejects.toThrow(/Only an admin/);
  await set("alice", "ai", 'AI OR "machine learning"');
  expect((await bob.query(api.research.records.listedShortcuts, { accountId: "bob", workspaceId, sort: "alpha", ...page })).page[0]).toMatchObject({ shorthand: "ai", expansion: 'AI OR "machine learning"' });
});

it("an organization's library says who saved each paper, and a person's own names no one", async () => {
  const { alice, bob, workspaceId, aliceOwn } = await lab();
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, paper: "https://openalex.org/W1", title: "One" });
  await bob.mutation(api.library.mutations.saveToLibrary, { workspaceId, paper: "https://openalex.org/W2", title: "Two" });
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId: aliceOwn, paper: "https://openalex.org/W3", title: "Three" });
  const view = { sortBy: "savedAt" as const, sortOrder: "asc" as const, paginationOpts: { cursor: null, numItems: 20 } };
  const lab_ = (await alice.query(api.library.queries.browseLibrary, { workspaceId, ...view })).page;
  expect(lab_.map((paper) => [paper.title, paper.by?.name, paper.by?.you])).toEqual([["One", "Alice", true], ["Two", "Bob", false]]);
  expect((await alice.query(api.library.queries.browseLibrary, { workspaceId: aliceOwn, ...view })).page[0]).not.toHaveProperty("by");
});
