// Guests of an item (#653): who its workspace's members can give it to, how many its plan
// allows, what an emailed invitation takes to accept, and what's left once the item changes.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { shownOutside } from "../library/followed";
import { ensureWorkspace } from "../workspaces/create";
import { personalWorkspaceOf } from "../workspaces/personal";

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

/** The addresses Clerk says the person answering has verified. */
let verified: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  vi.stubEnv("EL_SMTP_HOST", "smtp.example.test");
  vi.stubEnv("EL_SMTP_FROM", "libraries@example.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
  mail.sendMail.mockReset().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: verified.map((email_address) => ({ email_address, verification: { status: "verified" } })) })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * Alice and Bob are in the lab. Carol is in the club with Alice, and in nothing with Bob. Dave
 * is in no organization. The lab has a collection Alice made.
 */
async function lab(guests?: number) {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const users: Record<string, Id<"users">> = {};
    for (const clerkId of ["alice", "bob", "carol", "dave"]) users[clerkId] = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: clerkId[0].toUpperCase() + clerkId.slice(1), state: "active", createdAt: 1, updatedAt: 1 });
    const organization = async (slug: string, members: string[]) => {
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: `org_${slug}`, name: slug, slug, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      for (const clerkUserId of members) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${slug}_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      return ensureWorkspace(ctx, { kind: "organization", organizationId });
    };
    const workspaceId = await organization("lab", ["alice", "bob"]);
    const club = await organization("club", ["alice", "carol"]);
    if (guests !== undefined) await ctx.db.insert("billingAccounts", { workspaceId, plan: "free_organization", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, limits: { guests }, refreshedAt: Date.now() });
    return { users, workspaceId, club };
  });
  const [alice, bob, carol, dave] = ["alice", "bob", "carol", "dave"].map((subject) => t.withIdentity({ subject }));
  const { workspaceId } = seeded;
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Trials" });
  const item = { workspaceId, kind: "collection" as const, id };
  const guestsOf = () => t.run(async (ctx) => (await ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", id)).collect()).map(({ userId, role, name }) => ({ userId, role, name })));
  const invitationsOf = () => t.run(async (ctx) => (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", id)).collect()).map(({ email, role, state }) => ({ email, role, state })));
  return { t, alice, bob, carol, dave, item, guestsOf, invitationsOf, ...seeded };
}

it("gives a colleague an item at once, and no one a stranger's, a member's or another workspace's", async () => {
  const { t, alice, bob, carol, item, guestsOf, users, workspaceId } = await lab();

  await alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" });
  expect(await guestsOf()).toEqual([{ userId: users.carol, role: "viewer", name: "Trials" }]);
  const activity = await t.run((ctx) => ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", workspaceId).eq("item", `collection:${item.id}`)).collect());
  expect(activity.map(({ happened, detail }) => [happened, detail])).toContainEqual(["shared", "Carol"]);

  // Dave shares no organization with Alice, Bob is in the lab already, and Bob shares none with Carol.
  await expect(alice.mutation(api.sharing.guests.add, { ...item, userId: users.dave, role: "viewer" })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await expect(alice.mutation(api.sharing.guests.add, { ...item, userId: users.bob, role: "viewer" })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  // A guest acts in their own workspace, where the item isn't: they can't share it on.
  await expect(carol.mutation(api.sharing.guests.add, { kind: "collection", id: item.id, userId: users.dave, role: "viewer" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });

  // Any member makes a guest an editor.
  await bob.mutation(api.sharing.guests.setRole, { ...item, guest: { userId: users.carol }, role: "editor" });
  expect(await guestsOf()).toEqual([{ userId: users.carol, role: "editor", name: "Trials" }]);
  // A guest gives up their own place.
  await carol.mutation(api.sharing.guests.leave, { id: item.id });
  expect(await guestsOf()).toEqual([]);
});

it("lets a guest who edits a collection put papers in it and take them out, in the collection's own library, and no one else", async () => {
  const { t, alice, carol, dave, item, users, workspaceId, club } = await lab();
  const collectionId = item.id as Id<"collections">;
  const paper = { openalexId: "https://openalex.org/W1", title: "Tutoring at scale" };
  const put = (who: typeof carol, inCollection = true) => who.mutation(api.library.mutations.setPaperInCollection, { paper, collectionId, inCollection });
  const held = () => t.run(async (ctx) => (await ctx.db.get("collections", collectionId))!.itemCount);
  // What her collection picker offers beside her own collections, for this paper.
  const offered = async (who: typeof carol) => (await who.query(api.sharing.shared.editableCollections, { openalexId: paper.openalexId, paginationOpts: { cursor: null, numItems: 20 } })).page;

  // A viewer reads it, and someone it isn't shared with has nothing of it.
  await alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" });
  await expect(put(carol)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await expect(put(dave)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  expect(await held()).toBe(0);
  expect(await offered(carol)).toEqual([]);

  await alice.mutation(api.sharing.guests.setRole, { ...item, guest: { userId: users.carol }, role: "editor" });
  expect(await offered(carol)).toEqual([{ _id: collectionId, name: "Trials", itemCount: 0, containsItem: false, from: { name: "lab", organization: true } }]);
  // Her assistant asks her before it changes the lab's collection, which the lab's people see; Dave's has nothing to ask about.
  const asks = (userId: Id<"users">) => t.run(async (ctx) => shownOutside(ctx, { userId, workspaceId: await personalWorkspaceOf(ctx, userId) }, { collectionId }));
  expect([await asks(users.carol), await asks(users.dave)]).toEqual([true, false]);
  const { undo } = await put(carol);
  expect(await held()).toBe(1);
  expect(await offered(carol)).toMatchObject([{ itemCount: 1, containsItem: true }]);
  // In the club, an organization of hers, nothing is shared with her: it's hers in her own workspace.
  expect((await carol.query(api.sharing.shared.editableCollections, { workspaceId: club, paginationOpts: { cursor: null, numItems: 20 } })).page).toEqual([]);
  // The paper is the lab's, saved there by Carol: her own library has none of it.
  expect((await t.run((ctx) => ctx.db.query("libraryItems").collect())).map((saved) => ({ workspaceId: saved.workspaceId, createdBy: saved.createdBy }))).toEqual([{ workspaceId, createdBy: users.carol }]);
  // The lab's Activity for the collection says she put it there.
  const activity = await t.run((ctx) => ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", workspaceId).eq("item", `collection:${item.id}`)).collect());
  expect(activity.map(({ happened, by, detail }) => [happened, by, detail])).toContainEqual(["added", users.carol, "Tutoring at scale"]);

  // Her undo takes it out again, and by the saved paper's ID she puts it back and takes it out.
  await carol.mutation(api.library.mutations.setPaperInCollection, undo!.args);
  expect(await held()).toBe(0);
  // Putting in a paper the lab already has leaves the lab's record of it as it is, whatever hers says.
  await carol.mutation(api.library.mutations.setPaperInCollection, { paper: { ...paper, title: "Renamed by a guest" }, collectionId, inCollection: true });
  expect((await t.run((ctx) => ctx.db.query("libraryItems").collect())).map((saved) => saved.title)).toEqual(["Tutoring at scale"]);
  await put(carol, false);
  const libraryItemId = (await t.run((ctx) => ctx.db.query("libraryItems").first()))!._id;
  await carol.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId });
  expect(await held()).toBe(1);
  await carol.mutation(api.library.collections.removeFromCollection, { collectionId, libraryItemId });
  expect(await held()).toBe(0);

  // A viewer again, she changes nothing; nor does she once it's taken back.
  await put(carol);
  await alice.mutation(api.sharing.guests.setRole, { ...item, guest: { userId: users.carol }, role: "viewer" });
  await expect(put(carol, false)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await expect(carol.mutation(api.library.collections.removeFromCollection, { collectionId, libraryItemId })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  expect(await held()).toBe(1);
});

it("holds an item to the guests its workspace's plan allows, invitations still waiting among them", async () => {
  const { alice, item, guestsOf, invitationsOf, users } = await lab(1);
  const invite = (email: string) => alice.action(api.sharing.invitations.invite, { ...item, email, role: "viewer" });

  await invite("Eve@example.org");
  expect(mail.sendMail).toHaveBeenCalledTimes(1);
  expect(await invitationsOf()).toEqual([{ email: "eve@example.org", role: "viewer", state: "pending" }]);
  // The one place is the invitation's.
  await expect(alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" })).rejects.toThrow(/allows 1 guest /);
  await expect(invite("frank@example.org")).rejects.toThrow(/allows 1 guest /);
  // Sending it again takes no second place.
  await invite("eve@example.org");

  await alice.mutation(api.sharing.guests.remove, { ...item, guest: { email: "eve@example.org" } });
  await alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" });
  expect(await guestsOf()).toHaveLength(1);
  await expect(invite("frank@example.org")).rejects.toThrow(/allows 1 guest /);
});

it("makes an invitation the place of whoever accepts it with the invited address verified", async () => {
  const { alice, carol, dave, item, guestsOf, invitationsOf, users, t } = await lab(1);
  await alice.action(api.sharing.invitations.invite, { ...item, email: "dave@example.org", role: "viewer" });
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item.id)).first())!._id);

  // The link says nothing of the item to an account it wasn't sent to, which can't take it up either.
  verified = ["carol@example.org"];
  expect(await carol.query(api.sharing.invitations.get, { invitationId })).toEqual({ state: "other" });
  await expect(carol.action(api.sharing.invitations.respond, { invitationId, accept: true })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  // Nor can Dave while Clerk hasn't verified that address on his account.
  verified = ["someone@example.org"];
  await expect(dave.action(api.sharing.invitations.respond, { invitationId, accept: true })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  expect(await guestsOf()).toEqual([]);

  verified = ["dave@example.org"];
  expect(await dave.query(api.sharing.invitations.get, { invitationId })).toMatchObject({ state: "pending", name: "Trials", role: "viewer" });
  expect(await dave.action(api.sharing.invitations.respond, { invitationId, accept: true })).toEqual({ kind: "collection", id: item.id });
  expect(await guestsOf()).toEqual([{ userId: users.dave, role: "viewer", name: "Trials" }]);
  expect(await invitationsOf()).toEqual([{ email: "dave@example.org", role: "viewer", state: "accepted" }]);
  // A second tab that accepts it too opens the same item.
  expect(await dave.action(api.sharing.invitations.respond, { invitationId, accept: true })).toEqual({ kind: "collection", id: item.id });
  expect(await guestsOf()).toHaveLength(1);
  // It was the item's one place, and still is: nobody else fits.
  await expect(alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" })).rejects.toThrow(/allows 1 guest /);
});

it("keeps a guest's row to the item's name, and leaves none of an item that's deleted", async () => {
  const { t, alice, item, guestsOf, invitationsOf, users } = await lab();
  await alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" });
  await alice.action(api.sharing.invitations.invite, { ...item, email: "eve@example.org", role: "viewer" });

  await alice.mutation(api.library.collections.renameCollection, { workspaceId: item.workspaceId, collectionId: item.id, name: "Coaching trials" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await guestsOf()).toEqual([{ userId: users.carol, role: "viewer", name: "Coaching trials" }]);

  await alice.mutation(api.library.collections.deleteCollection, { workspaceId: item.workspaceId, collectionId: item.id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await guestsOf()).toEqual([]);
  expect(await invitationsOf()).toEqual([]);
});

it("opens a shared collection to its guest from their own workspace, and to nobody else", async () => {
  const { t, alice, carol, dave, item, users, club } = await lab();
  const { id: saved } = await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId: item.workspaceId, openalexId: "https://openalex.org/W1", title: "One", collectionId: item.id });
  await alice.mutation(api.library.collections.setCollectionRating, { workspaceId: item.workspaceId, collectionId: item.id, libraryItemId: saved, rating: 4, expect: null });
  await alice.mutation(api.sharing.guests.add, { ...item, userId: users.carol, role: "viewer" });
  const view = { sortBy: "savedAt" as const, sortOrder: "desc" as const, collectionId: item.id };
  const titles = async (as: typeof carol, workspaceId?: Id<"workspaces">) => (await as.query(api.library.queries.browseLibrary, { ...view, ...(workspaceId ? { workspaceId } : {}), paginationOpts: { cursor: null, numItems: 10 } })).page.map((paper) => paper.title);

  // Carol reads it in her own workspace: its papers, its count and whose it is.
  expect(await titles(carol)).toEqual(["One"]);
  expect((await carol.query(api.library.queries.getLibraryFilteredCount, view)).count).toBe(1);
  expect(await carol.query(api.library.collections.getCollection, { collectionId: item.id })).toEqual({ _id: item.id, name: "Trials", itemCount: 1, guest: { role: "viewer", from: { name: "lab", organization: true } } });
  // She reads how its members rated each paper in it, and has no rating there herself.
  const [paper] = (await carol.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(paper.collection).toMatchObject({ count: 1, raters: [{ name: "Alice", rating: 4 }] });
  expect(paper.collection).not.toHaveProperty("mine");
  const raters = (as: typeof carol) => as.query(api.library.collections.raters, { collectionId: item.id, libraryItemId: saved, paginationOpts: { cursor: null, numItems: 10 } });
  expect((await raters(carol)).page).toMatchObject([{ name: "Alice", rating: 4 }]);
  await expect(raters(dave)).rejects.toThrow();
  // Not while she acts in the club, whose credits aren't hers to spend on it.
  expect(await titles(carol, club)).toEqual([]);
  // Dave was given nothing.
  expect(await titles(dave)).toEqual([]);
  expect(await dave.query(api.library.collections.getCollection, { collectionId: item.id })).toBeNull();

  // The assistant lists it for her too. Its rows are the lab's: each names a library item only once she has saved the paper herself.
  const listed = async () => (await carol.query(api.library.queries.papers, { collectionId: item.id })).papers.map(({ id, libraryItemId, inCollection }) => ({ id, libraryItemId, inCollection }));
  expect(await listed()).toEqual([{ id: "https://openalex.org/W1", libraryItemId: undefined, inCollection: false }]);
  const { id: hers } = await carol.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W1", title: "One" });
  expect(await listed()).toEqual([{ id: "https://openalex.org/W1", libraryItemId: hers, inCollection: false }]);

  // An export she started reads the collection again for each part, so it ends with her place.
  const carolOwn = await t.run((ctx) => personalWorkspaceOf(ctx, users.carol));
  const exported = () => t.query(internal.exports.page, { userId: users.carol, workspaceId: carolOwn, source: { kind: "library", view }, format: "json", cursor: null, written: 0 });
  expect((await exported()).count).toBe(1);

  // A paper taken out of the collection takes its ratings there out of her reach.
  await alice.mutation(api.library.collections.removeFromCollection, { workspaceId: item.workspaceId, collectionId: item.id, libraryItemId: saved });
  await expect(raters(carol)).rejects.toThrow();
  await alice.mutation(api.library.collections.addToCollection, { workspaceId: item.workspaceId, collectionId: item.id, libraryItemId: saved });

  await alice.mutation(api.sharing.guests.remove, { ...item, guest: { userId: users.carol } });
  expect(await titles(carol)).toEqual([]);
  expect((await exported()).count).toBe(0);
});

it("closes what a deleted account shared from its own workspace, though its data waits to be purged", async () => {
  const { t, alice, carol, dave, users } = await lab();
  const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, users.alice));
  const { id } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Mine" });
  await alice.mutation(api.sharing.guests.add, { workspaceId, kind: "collection", id, userId: users.carol, role: "viewer" });
  await alice.action(api.sharing.invitations.invite, { workspaceId, kind: "collection", id, email: "dave@example.org", role: "viewer" });
  const shared = { kind: undefined, text: "", sort: "recent" as const, paginationOpts: { cursor: null, numItems: 10 } };
  expect((await carol.query(api.sharing.shared.list, shared)).page.map((row) => row.name)).toEqual(["Mine"]);

  await t.mutation(internal.users.internal.markUserDeletedFromClerk, { eventId: "evt_gone", eventType: "user.deleted", instanceId: "ins_test", occurredAt: Date.now(), payloadSha256: "sha_gone", clerkId: "alice" });
  // Closed from that moment, before the cleanup has taken a row: nobody opens it or accepts an invitation to it.
  expect(await carol.query(api.library.collections.getCollection, { collectionId: id as Id<"collections"> })).toBeNull();
  const waiting = await t.run(async (ctx) => (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", id)).first())!._id);
  verified = ["dave@example.org"];
  await expect(dave.action(api.sharing.invitations.respond, { invitationId: waiting, accept: true })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  expect(await dave.query(api.sharing.invitations.get, { invitationId: waiting })).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  // The collection is still there, for its retention, and nobody is its guest or invited to it.
  expect(await t.run((ctx) => ctx.db.get("collections", id as Id<"collections">))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", id)).collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", id)).collect())).toEqual([]);
  expect((await carol.query(api.sharing.shared.list, shared)).page).toEqual([]);
});

it("takes a deleted account's places as a guest in steps of their own", async () => {
  const { t, users } = await lab();
  await t.run(async (ctx) => {
    for (let n = 0; n < 60; n++) await ctx.db.insert("itemAccess", { kind: "collection", item: `gone_${n}`, name: `Collection ${n}`, userId: users.carol, role: "viewer", grantedBy: users.alice, grantedAt: n });
  });
  await t.mutation(internal.sharing.upkeep.purge, { userId: users.carol });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("itemAccess").withIndex("by_user_and_grantedAt", (q) => q.eq("userId", users.carol)).collect())).toEqual([]);
});
