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
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
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
