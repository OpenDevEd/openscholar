// Every account and every organization has exactly one workspace (#650): made with it, or
// by the backfill for those from before, however often the backfill runs.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { createUserWithDefaults } from "../lib/userCreation";
import { applyOrganizationProjection } from "../webhooks/projections";
import { installFakeAutumn } from "../billing/billing.test-support";
import { ensureWorkspace } from "./create";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { paperOf } from "../lib/paperRef.test-support";

const organization = (clerkOrganizationId: string, clerkUpdatedAt: number) => ({
  clerkOrganizationId,
  name: "Learning Lab",
  slug: clerkOrganizationId,
  clerkCreatedAt: 1,
  clerkUpdatedAt,
});

const event = (eventId: string, occurredAt: number) => ({
  eventId,
  eventType: "organization.updated",
  instanceId: "ins_test",
  occurredAt,
  payloadSha256: eventId.padEnd(64, "a"),
  processedAt: occurredAt * 1_000,
});

/** A backend, and the workspaces of an account or an organization in it: at most two, so a duplicate shows. */
function setup() {
  const t = convexTest(schema);
  const workspacesOf = (owner: { userId: Id<"users"> } | { organizationId: Id<"organizations"> }) =>
    t.run((ctx) =>
      "userId" in owner
        ? ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", owner.userId)).take(2)
        : ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", owner.organizationId)).take(2),
    );
  return { t, workspacesOf };
}

describe("workspaces", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeAutumn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives a new account its personal workspace and a new organization its own, once", async () => {
    const { t, workspacesOf } = setup();
    // Untriggered: the harness gives an account seeded through `t.run` a workspace itself, which would hide one this didn't make.
    const userId = await runUntriggered(t, (ctx) => createUserWithDefaults(ctx, { clerkId: "user_new", email: "new@example.org" }));
    // The organization's creation, then a later change to it.
    for (const [id, at] of [["msg_created", 100], ["msg_renamed", 200]] as const) {
      await t.run((ctx) => applyOrganizationProjection(ctx, { ...event(id, at), action: "upsert", entityId: "org_new", organization: organization("org_new", at) }));
    }
    const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerkOrganizationId", (q) => q.eq("clerkOrganizationId", "org_new")).unique())!._id);

    expect(await workspacesOf({ userId })).toMatchObject([{ kind: "personal", userId }]);
    expect(await workspacesOf({ organizationId })).toMatchObject([{ kind: "organization", organizationId }]);
  });

  it("removes an account's workspace with it when the cleanup removes the account, keeps what it made in an organization, and keeps who it was", async () => {
    const { t, workspacesOf } = setup();
    const userId = await t.run((ctx) => createUserWithDefaults(ctx, { clerkId: "user_leaving", email: "leaving@example.org", firstName: "Lea", lastName: "Ving" }));
    const { own, theirs, lab } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { ...organization("org_stays", 1), state: "active", createdAt: 1, updatedAt: 1 });
      const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
      const job = { userId, createdBy: userId, sourceType: "history" as const, createdAt: 1, updatedAt: 1 };
      const mine = (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())!._id;
      // A bookmark, a saved paper in a collection and a finished screening job in each workspace.
      const records = async (workspaceId: typeof mine) => {
        await ctx.db.insert("queryShortcuts", { workspaceId, createdBy: userId, data: { shorthand: "rct", expansion: "randomized", createdAt: 1 } });
        const libraryItemId = await ctx.db.insert("libraryItems", { workspaceId, createdBy: userId, ...paperOf("https://openalex.org/W1"), title: "Trial", searchableText: "Trial", savedAt: 1, updatedAt: 1 });
        const collectionId = await ctx.db.insert("collections", { workspaceId, createdBy: userId, name: "Trials", sortName: "trials", itemCount: 1, createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId, assignedAt: 1 });
        const screeningId = await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: 1 });
        const jobId = await ctx.db.insert("screeningJobs", { workspaceId, createdBy: userId, screeningId, status: "completed", totalPapers: 1, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("screeningResults", { jobId, ...paperOf("https://openalex.org/W1"), title: "Trial", status: "completed", createdAt: 1 });
      };
      await records(mine);
      await records(lab);
      // Their ratings: their own, and one they gave in a collection.
      await ctx.db.insert("ratings", { userId, paperId: "openalex:W1", rating: 4 });
      await ctx.db.insert("ratings", { userId, paperId: "openalex:W1", collectionId: (await ctx.db.query("collections").first())!._id, rating: 5 });
      return {
        lab,
        own: await ctx.db.insert("extractionJobs", { ...job, workspaceId: mine, name: "Mine" }),
        theirs: await ctx.db.insert("extractionJobs", { ...job, workspaceId: lab, name: "The lab's" }),
      };
    });
    const tables = ["queryShortcuts", "libraryItems", "collections", "libraryItemCollections", "screenings", "screeningJobs", "screeningResults"] as const;
    const counts = () => t.run(async (ctx) => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await ctx.db.query(table).collect()).length]))));
    expect(Object.values(await counts())).toEqual(tables.map(() => 2));
    // Past the retention period, cleanup removes a deleted account and what it held in its own workspace.
    await t.run((ctx) => ctx.db.patch("users", userId, { state: "deleted", updatedAt: 1 }));
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toBeNull();
    expect(await workspacesOf({ userId })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("extractionJobs", own))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("extractionJobs", theirs))).toMatchObject({ name: "The lab's", createdBy: userId });
    expect(await t.run((ctx) => ctx.db.query("ratings").collect())).toEqual([]);
    // What was in their own workspace is gone; the organization's copies stay.
    expect(Object.values(await counts())).toEqual(tables.map(() => 1));
    expect(await t.run(async (ctx) => (await ctx.db.query("libraryItems").collect()).map((item) => item.workspaceId))).toEqual([lab]);
    expect(await t.run((ctx) => ctx.db.query("clerkDeletedUsers").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())).toMatchObject({ clerkId: "user_leaving", name: "Lea Ving" });
  });

  it("gives every account and organization from before one workspace, deleted ones too, however often it runs", async () => {
    const { t, workspacesOf } = setup();
    const already = await runUntriggered(t, (ctx) => createUserWithDefaults(ctx, { clerkId: "user_new", email: "new@example.org" }));
    // As they were before workspaces: the harness gives an account seeded through `t.run` its workspace.
    const before = await runUntriggered(t, async (ctx) => ({
      users: await Promise.all(
        (["active", "deleted"] as const).map((state) => ctx.db.insert("users", { clerkId: `user_${state}`, email: `${state}@example.org`, state, createdAt: 1, updatedAt: 1 })),
      ),
      organizations: await Promise.all(
        (["active", "deleted"] as const).map((state) => ctx.db.insert("organizations", { ...organization(`org_${state}`, 1), state, createdAt: 1, updatedAt: 1 })),
      ),
    }));

    expect(await t.action(internal.migrations.workspaces.verify, {})).toBe(4);
    for (let runs = 0; runs < 2; runs++) {
      await t.mutation(internal.migrations.workspaces.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await t.action(internal.migrations.workspaces.verify, {})).toBe(0);

    for (const userId of [already, ...before.users]) expect(await workspacesOf({ userId })).toMatchObject([{ kind: "personal", userId }]);
    for (const organizationId of before.organizations) expect(await workspacesOf({ organizationId })).toMatchObject([{ kind: "organization", organizationId }]);
  });
});

describe("acting in a workspace", () => {
  /** Alice and Bob, Alice's own and Bob's workspaces, and an organization Alice is a member of. */
  async function setup() {
    const t = convexTest(schema);
    const seeded = await t.run(async (ctx) => {
      const [alice, bob] = await Promise.all(
        ["alice", "bob"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 })),
      );
      const own = async (userId: Id<"users">) => (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())!._id;
      const organizationId = await ctx.db.insert("organizations", { ...organization("org_lab", 1), state: "active", createdAt: 1, updatedAt: 1 });
      const membershipId = await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "orgmem_alice", clerkUserId: "alice", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
      return { alice, aliceOwn: await own(alice), bobOwn: await own(bob), organizationId, membershipId, lab };
    });
    return { t, asAlice: t.withIdentity({ subject: "alice" }), ...seeded };
  }

  it("lets a person act in their own workspace and their organizations', and in no one else's", async () => {
    const { t, asAlice, aliceOwn, bobOwn, lab, organizationId, membershipId } = await setup();
    const count = (workspaceId: Id<"workspaces">) => asAlice.query(api.library.collections.countCollections, { workspaceId });
    expect(await count(aliceOwn)).toBe(0);
    expect(await count(lab)).toBe(0);
    await expect(count(bobOwn)).rejects.toThrow(/Workspace not found/);
    await expect(asAlice.mutation(api.library.collections.createCollection, { workspaceId: bobOwn, name: "Not mine" })).rejects.toThrow(/Workspace not found/);

    // Once their membership is revoked, or the organization deleted, its workspace is no one's to act in.
    await t.run((ctx) => ctx.db.patch("organizationMemberships", membershipId, { state: "revoked" }));
    await expect(count(lab)).rejects.toThrow(/Workspace not found/);
    await t.run(async (ctx) => {
      await ctx.db.patch("organizationMemberships", membershipId, { state: "active" });
      await ctx.db.patch("organizations", organizationId, { state: "deleted" });
    });
    await expect(count(lab)).rejects.toThrow(/Workspace not found/);
  });

  it("finds an organization's pages by its slug, and an item's workspace by its address, for its members only", async () => {
    const { t, asAlice, aliceOwn, bobOwn, lab } = await setup();
    const asBob = t.withIdentity({ subject: "bob" });
    // /o/org_lab is the lab's workspace for Alice, and no page at all for Bob.
    expect(await asAlice.query(api.workspaces.queries.bySlug, { slug: "org_lab" })).toBe(lab);
    expect(await asBob.query(api.workspaces.queries.bySlug, { slug: "org_lab" })).toBeNull();
    // A collection of the lab's, opened from her own workspace, is the lab's: its pages are under /o/org_lab.
    const collectionId = await t.run(async (ctx) => ctx.db.insert("collections", { workspaceId: lab, createdBy: (await ctx.db.query("users").first())!._id, name: "Shared", sortName: "shared", itemCount: 0, createdAt: 1, updatedAt: 1 }));
    expect(await asAlice.query(api.workspaces.queries.homeOf, { kind: "collection", id: collectionId, here: aliceOwn })).toEqual({ slug: "org_lab" });
    expect(await asBob.query(api.workspaces.queries.homeOf, { kind: "collection", id: collectionId, here: bobOwn })).toBeNull();
    // A search's address carries its ID in its workspace; one both her workspaces have opens where the page is.
    await t.run(async (ctx) => {
      const at = "2026-10-01T00:00:00.000Z";
      const data = { id: "s_same", query: "tutoring", field: "title" as const, count: 1, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: at, updatedAt: at };
      for (const workspaceId of [aliceOwn, lab]) await ctx.db.insert("searches", { workspaceId, createdBy: (await ctx.db.query("users").first())!._id, localId: "s_same", revision: 1, data });
    });
    expect(await asAlice.query(api.workspaces.queries.homeOf, { kind: "search", id: "s_same", here: aliceOwn })).toEqual({});
    expect(await asAlice.query(api.workspaces.queries.homeOf, { kind: "search", id: "s_same", here: lab })).toEqual({ slug: "org_lab" });
  });

  it("lets the assistant act only in a workspace of the person it acts for", async () => {
    const { t, alice, aliceOwn, bobOwn } = await setup();
    expect(await t.query(internal.library.collections.countCollectionsForAssistant, { userId: alice, workspaceId: aliceOwn })).toBe(0);
    await expect(t.query(internal.library.collections.countCollectionsForAssistant, { userId: alice, workspaceId: bobOwn })).rejects.toThrow(/Workspace not found/);
  });
});
