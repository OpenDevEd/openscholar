// An item's Activity (#656): the user action wrappers write what each change did and who made it.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ensureWorkspace } from "../workspaces/create";

/** Alice and Bob in a lab, and Carol, who isn't. */
async function lab() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob", "carol"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const clerkUserId of ["alice", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    return { users, workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId }), carolOwn: await ensureWorkspace(ctx, { kind: "personal", userId: users.carol }) };
  });
  const [alice, bob, carol] = ["alice", "bob", "carol"].map((subject) => t.withIdentity({ subject }));
  return { t, alice, bob, carol, ...seeded };
}

it("lists what changed on a collection, newest first, by whom, and what the assistant did for someone", async () => {
  const { alice, bob, workspaceId } = await lab();
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await alice.mutation(api.library.collections.renameCollection, { workspaceId, collectionId, name: "RCTs" });
  // A rename to the name it has changes nothing, and notes nothing.
  await alice.mutation(api.library.collections.renameCollection, { workspaceId, collectionId, name: "RCTs" });
  await bob.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "Coaching at scale", collectionId });
  const listed = async (as: typeof alice) => (await as.query(api.activity.queries.list, { workspaceId, kind: "collection", id: collectionId, paginationOpts: { cursor: null, numItems: 10 } })).page;

  expect((await listed(alice)).map(({ by, happened, count, detail, viaAssistant }) => ({ by: by.name, you: by.you, happened, count, detail, viaAssistant }))).toEqual([
    { by: "Bob", you: false, happened: "added", count: 1, detail: "Coaching at scale", viaAssistant: undefined },
    { by: "Alice", you: true, happened: "renamed", count: undefined, detail: "Trials", viaAssistant: undefined },
    { by: "Alice", you: true, happened: "created", count: undefined, detail: "Trials", viaAssistant: undefined },
  ]);
});

it("says when the assistant made a change, as the person who asked", async () => {
  const { t, alice, users, workspaceId } = await lab();
  const { id } = await t.mutation(internal.library.collections.createCollectionForAssistant, { userId: users.alice, workspaceId, name: "From the chat" });
  const [row] = (await alice.query(api.activity.queries.list, { workspaceId, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(row).toMatchObject({ by: { name: "Alice", you: true }, happened: "created", viaAssistant: true });
});

it("shows an item's activity only in the workspace that has it", async () => {
  const { alice, carol, workspaceId, carolOwn } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  await expect(carol.query(api.activity.queries.list, { workspaceId: carolOwn, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  await expect(carol.query(api.activity.queries.list, { workspaceId, kind: "collection", id, paginationOpts: { cursor: null, numItems: 10 } })).rejects.toThrow();
});

it("names who started an item in an organization, and no one in your own workspace", async () => {
  const { alice, bob, carol, workspaceId, carolOwn } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  expect(await bob.query(api.activity.queries.startedBy, { workspaceId, kind: "collection", id })).toMatchObject({ name: "Alice", you: false });
  expect(await alice.query(api.activity.queries.startedBy, { workspaceId, kind: "collection", id })).toMatchObject({ name: "Alice", you: true });
  const { id: own } = await carol.mutation(api.library.collections.createCollection, { workspaceId: carolOwn, name: "Mine" });
  expect(await carol.query(api.activity.queries.startedBy, { workspaceId: carolOwn, kind: "collection", id: own })).toBeNull();
});
