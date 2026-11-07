/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { EVIDENCE_LIBRARIES_FEATURE } from "../lib/billing/plans";
import { seedFeatureUser, seedOrganizationFeatures } from "./organizationFeatures.test-support";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { MEMBERSHIP_REVOKE_BATCH } from "./webhooks/projections";
import { organizationWorkspaceOf } from "./workspaces/personal";
import { ensureWorkspace } from "./workspaces/create";
import { readMemberOrganizations } from "./organizationFeatures";
import { createEvidenceLibrarySetup } from "./evidenceLibraries/mutations";
import { requireEvidenceLibraryAccess } from "./evidenceLibraries/access";

const modules = import.meta.glob("/convex/**/*.ts");
const off = { evidenceLibraries: false, authors: false, createsCommunities: false };
// For a member who isn't an admin: on for the workspace, but creating a community is its admins'.
const on = { evidenceLibraries: true, authors: true, createsCommunities: false };

/** Sets what the plan of an organization's workspace grants, as when it changes plan. */
async function planGrants(ctx: MutationCtx, organizationId: Id<"organizations">, features: string[]) {
  const workspaceId = await organizationWorkspaceOf(ctx, organizationId);
  const account = await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  await ctx.db.patch("billingAccounts", account!._id, { features });
}

describe("what a workspace opens", () => {
  test("Evidence Libraries where the workspace's own plan includes them, and nowhere else of the person's", async () => {
    const t = convexTest(schema, modules);
    const { withThem, without } = await t.run(async (ctx) => {
      await seedFeatureUser(ctx, "member");
      const withThem = await seedOrganizationFeatures(ctx, ["member"], { evidenceLibraries: true });
      const without = await seedOrganizationFeatures(ctx, ["member"], {});
      return { withThem: await organizationWorkspaceOf(ctx, withThem), without: await organizationWorkspaceOf(ctx, without) };
    });
    // The session's active organization claim changes nothing: the workspace asked about decides.
    for (const identity of [{ subject: "member" }, { subject: "member", o: { id: "unrelated", rol: "org:member" } }]) {
      const member = t.withIdentity(identity);
      expect(await member.query(api.organizationFeatures.opens, { workspaceId: withThem })).toEqual(on);
      // Being in an organization that has them opens nothing in another, nor in the person's own workspace.
      expect(await member.query(api.organizationFeatures.opens, { workspaceId: without })).toEqual(off);
      expect(await member.query(api.organizationFeatures.opens, {})).toEqual(off);
    }
    // An author profile is made where Evidence Libraries are: not in their own workspace, whatever their organizations have.
    const member = t.withIdentity({ subject: "member" });
    await expect(member.mutation(api.authors.profiles.create, { name: "Someone" })).rejects.toThrow(/FORBIDDEN/);
    await expect(member.mutation(api.authors.profiles.create, { workspaceId: without, name: "Someone" })).rejects.toThrow(/FORBIDDEN/);
    await member.mutation(api.authors.profiles.create, { workspaceId: withThem, name: "Someone" });
  });

  test("a change of plan takes it away at once, and a workspace the person can no longer act in answers nothing", async () => {
    const t = convexTest(schema, modules);
    const { id, workspaceId } = await t.run(async (ctx) => {
      await seedFeatureUser(ctx, "member");
      const id = await seedOrganizationFeatures(ctx, ["member"], { evidenceLibraries: true });
      return { id, workspaceId: await organizationWorkspaceOf(ctx, id) };
    });
    const member = t.withIdentity({ subject: "member" });
    const opens = () => member.query(api.organizationFeatures.opens, { workspaceId });
    expect(await opens()).toEqual(on);
    await t.run((ctx) => planGrants(ctx, id, []));
    expect(await opens()).toEqual(off);
    await t.run((ctx) => planGrants(ctx, id, [EVIDENCE_LIBRARIES_FEATURE]));
    expect(await opens()).toEqual(on);
    // Deleted, or left: it isn't theirs to ask about.
    await t.run((ctx) => ctx.db.patch("organizations", id, { state: "deleted" }));
    await expect(opens()).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch("organizations", id, { state: "active" });
      const membership = await ctx.db.query("organizationMemberships").first();
      await ctx.db.patch("organizationMemberships", membership!._id, { state: "revoked" });
    });
    await expect(opens()).rejects.toThrow();
  });

  test("nothing of another's for someone signed out or outside the organization", async () => {
    const t = convexTest(schema, modules);
    const workspaceId = await t.run(async (ctx) => {
      for (const clerkId of ["member", "outsider"]) await seedFeatureUser(ctx, clerkId);
      return organizationWorkspaceOf(ctx, await seedOrganizationFeatures(ctx, ["member"], { evidenceLibraries: true }));
    });
    expect(await t.query(api.organizationFeatures.opens, { workspaceId })).toEqual(off);
    const outsider = t.withIdentity({ subject: "outsider", o: { id: "forged", rol: "org:admin" } });
    await expect(outsider.query(api.organizationFeatures.opens, { workspaceId })).rejects.toThrow();
    expect(await outsider.query(api.organizationFeatures.opens, {})).toEqual(off);
  });
});

test("a community is created in your own workspace or an organization you're an admin of, once Evidence Communities are on for it", async () => {
  const t = convexTest(schema, modules);
  const { alpha, memberOnly, disabled, foreign, own, other } = await t.run(async (ctx) => {
    await seedFeatureUser(ctx, "owner");
    await seedFeatureUser(ctx, "someone-else");
    const workspaces: Record<string, Id<"workspaces">> = {};
    for (const name of ["alpha", "memberOnly", "disabled", "foreign"]) {
      const id = await seedOrganizationFeatures(ctx, name === "foreign" ? ["someone-else"] : ["owner"], { evidenceLibraries: name !== "disabled" });
      const membership = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", id).eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", membership!._id, { role: name === "memberOnly" ? "org:member" : "org:admin" });
      workspaces[name] = await ensureWorkspace(ctx, { kind: "organization", organizationId: id });
    }
    const user = async (clerkId: string) => (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique())!._id;
    const own = await ensureWorkspace(ctx, { kind: "personal", userId: await user("owner") });
    const other = await ensureWorkspace(ctx, { kind: "personal", userId: await user("someone-else") });
    // Switched on for the other person's own workspace, which still isn't the owner's to create in.
    await ctx.db.patch("workspaces", other, { evidenceLibraries: true });
    return { ...workspaces, own, other } as Record<"alpha" | "memberOnly" | "disabled" | "foreign" | "own" | "other", Id<"workspaces">>;
  });
  const owner = t.withIdentity({ subject: "owner", o: { id: "unrelated", rol: "org:member" } });
  const create = (workspaceId: Id<"workspaces">, slug: string) => owner.run((ctx) => createEvidenceLibrarySetup(ctx, { workspaceId, name: slug, slug, publicAddress: `https://${slug}.example.org` }));
  const creates = async (workspaceId: Id<"workspaces">) => (await owner.query(api.organizationFeatures.opens, { workspaceId })).createsCommunities;

  const made = await create(alpha, "alpha-community");
  expect(await t.run((ctx) => ctx.db.get("evidenceLibraries", made.libraryId))).toMatchObject({ workspaceId: alpha });
  expect(await creates(alpha)).toBe(true);
  for (const [workspaceId, slug] of [[memberOnly, "member-only"], [disabled, "disabled"], [foreign, "foreign"], [own, "own-off"], [other, "other"]] as const) {
    await expect(create(workspaceId, slug)).rejects.toThrow(/FORBIDDEN/);
  }
  expect(await creates(memberOnly)).toBe(false);
  expect(await creates(disabled)).toBe(false);
  expect(await creates(own)).toBe(false);

  // OpenScholar's admins switch it on for the person's own workspace, as they do for an organization.
  await t.run((ctx) => ctx.db.patch("workspaces", own, { evidenceLibraries: true }));
  expect(await creates(own)).toBe(true);
  const mine = await create(own, "own-community");
  expect(await t.run((ctx) => ctx.db.get("evidenceLibraries", mine.libraryId))).toMatchObject({ workspaceId: own });
  expect((await owner.query(api.evidenceLibraries.queries.listLibraries, { paginationOpts: { cursor: null, numItems: 50 } })).page).toEqual([expect.objectContaining({ _id: mine.libraryId, role: "owner" })]);

  // Off again: nothing new is made, and what was made stays its owner's to manage.
  await t.run((ctx) => ctx.db.patch("workspaces", own, { evidenceLibraries: undefined }));
  await expect(create(own, "own-again")).rejects.toThrow(/FORBIDDEN/);
  await expect(owner.run((ctx) => requireEvidenceLibraryAccess(ctx, mine.libraryId, "manage"))).resolves.toMatchObject({ role: "owner" });
});

test("refuses to read a person in more organizations than one read takes, not a partial list (#427)", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedFeatureUser(ctx, "joiner");
    for (let i = 0; i < MAX_ORGANIZATIONS_PER_PERSON; i += 1) await seedOrganizationFeatures(ctx, ["joiner"], { evidenceLibraries: true });
  });
  const joiner = t.withIdentity({ subject: "joiner" });
  // A member of each: all of them read.
  await expect(joiner.run((ctx) => readMemberOrganizations(ctx))).resolves.toHaveLength(MAX_ORGANIZATIONS_PER_PERSON);
  await t.run((ctx) => seedOrganizationFeatures(ctx, ["joiner"], { evidenceLibraries: true }));
  await expect(joiner.run((ctx) => readMemberOrganizations(ctx))).rejects.toThrow(/more than 200 organizations/);
});

test("a sweep of a deleted organization's memberships stops once the organization is active again (#427)", async () => {
  const t = convexTest(schema, modules);
  const organization = await t.run(async (ctx) =>
    (await ctx.db.get("organizations", await seedOrganizationFeatures(ctx, Array.from({ length: MEMBERSHIP_REVOKE_BATCH + 1 }, (_, i) => `member_${i}`), { evidenceLibraries: true })))!);
  const event = { instanceId: "ins_test", payloadSha256: "a".repeat(64), entityId: organization.clerkOrganizationId };
  const { _id, clerkOrganizationId, name, slug, clerkCreatedAt, clerkUpdatedAt } = organization;
  const snapshot = { clerkOrganizationId, name, slug, clerkCreatedAt, clerkUpdatedAt: clerkUpdatedAt + 1 };
  vi.useFakeTimers();
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, { ...event, eventId: "msg_gone", eventType: "organization.deleted", occurredAt: 100, action: "delete" });
  // A newer organization event arrives before the second batch runs.
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, { ...event, eventId: "msg_back", eventType: "organization.updated", occurredAt: 200, action: "upsert", organization: snapshot });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const left = await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", _id).eq("state", "active")).take(2));
  expect(left).toHaveLength(1);
});

test("a deleted organization's memberships are revoked, however many it has (#427)", async () => {
  const t = convexTest(schema, modules);
  const members = ["joiner", ...Array.from({ length: MEMBERSHIP_REVOKE_BATCH }, (_, i) => `member_${i}`)];
  const { gone, kept } = await t.run(async (ctx) => {
    const gone = (await ctx.db.get("organizations", await seedOrganizationFeatures(ctx, members, { evidenceLibraries: true })))!;
    return { gone, kept: await seedOrganizationFeatures(ctx, ["joiner"], { evidenceLibraries: true }) };
  });
  vi.useFakeTimers();
  await t.mutation(internal.webhooks.projections.applyOrganizationEvent, {
    eventId: "msg_gone", eventType: "organization.deleted", instanceId: "ins_test", occurredAt: Date.now(), payloadSha256: "a".repeat(64),
    action: "delete", entityId: gone.clerkOrganizationId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const active = await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", "joiner").eq("state", "active")).take(3));
  expect(active.map((membership) => membership.organizationId)).toEqual([kept]);
  expect(await t.run((ctx) => ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", gone._id).eq("state", "active")).first())).toBeNull();
});
