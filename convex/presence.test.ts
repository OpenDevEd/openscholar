// Who else has an item open (#657): only people who can open the item join its room or read it.
import { register as registerPresence } from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { ensureWorkspace } from "./workspaces/create";

/** Alice and Bob in a lab, and Carol, who isn't. */
async function lab() {
  const t = convexTest(schema);
  registerPresence(t);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob", "carol"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const clerkUserId of ["alice", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    return { workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId }), carolOwn: await ensureWorkspace(ctx, { kind: "personal", userId: users.carol }) };
  });
  const [alice, bob, carol] = ["alice", "bob", "carol"].map((subject) => t.withIdentity({ subject }));
  return { t, alice, bob, carol, ...seeded };
}

it("shows the others in an item's room, never yourself", async () => {
  const { alice, bob, workspaceId } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  const item = { workspaceId, kind: "collection" as const, id };
  await alice.mutation(api.presence.heartbeat, { ...item, sessionId: "alice-tab" });
  expect((await bob.query(api.presence.here, item)).map((person) => person.name)).toEqual(["Alice"]);
  expect(await alice.query(api.presence.here, item)).toEqual([]);
});

it("lets no one in who can't open the item", async () => {
  const { alice, carol, workspaceId, carolOwn } = await lab();
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  // Carol isn't in the lab.
  await expect(carol.mutation(api.presence.heartbeat, { workspaceId, kind: "collection", id, sessionId: "carol-tab" })).rejects.toThrow();
  await expect(carol.query(api.presence.here, { workspaceId, kind: "collection", id })).rejects.toThrow();
  // An item named from another workspace has no room there.
  await expect(carol.mutation(api.presence.heartbeat, { workspaceId: carolOwn, kind: "collection", id, sessionId: "carol-tab" })).rejects.toThrow(/isn't in this workspace/);
});

it("keeps an extraction's room shut to someone without the extraction feature", async () => {
  const { t, alice, bob, workspaceId } = await lab();
  const users = await t.run(async (ctx) => ({ alice: (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "alice")).unique())!._id }));
  // A job in the lab; no extraction feature is switched on anywhere.
  const id = await t.run((ctx) => ctx.db.insert("extractionJobs", { workspaceId, createdBy: users.alice, name: "Sample sizes", searchText: "sample sizes", sourceType: "history", status: "pending", totalPapers: 0, runEpoch: 0, createdAt: 1, updatedAt: 1 }));
  const item = { workspaceId, kind: "extraction" as const, id };
  await expect(alice.mutation(api.presence.heartbeat, { ...item, sessionId: "alice-tab" })).rejects.toThrow(/isn't in this workspace/);
  expect(await bob.query(api.presence.here, item)).toEqual([]);
});
