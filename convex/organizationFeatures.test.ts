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

const modules = import.meta.glob("/convex/**/*.ts");
const off = { evidenceLibraries: false };

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
      expect(await member.query(api.organizationFeatures.get, { workspaceId: withThem })).toEqual({ evidenceLibraries: true });
      // Being in an organization that has them opens nothing in another, nor in the person's own workspace.
      expect(await member.query(api.organizationFeatures.get, { workspaceId: without })).toEqual(off);
      expect(await member.query(api.organizationFeatures.get, {})).toEqual(off);
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
    const opens = () => member.query(api.organizationFeatures.get, { workspaceId });
    expect(await opens()).toEqual({ evidenceLibraries: true });
    await t.run((ctx) => planGrants(ctx, id, []));
    expect(await opens()).toEqual(off);
    await t.run((ctx) => planGrants(ctx, id, [EVIDENCE_LIBRARIES_FEATURE]));
    expect(await opens()).toEqual({ evidenceLibraries: true });
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
    expect(await t.query(api.organizationFeatures.get, { workspaceId })).toEqual(off);
    const outsider = t.withIdentity({ subject: "outsider", o: { id: "forged", rol: "org:admin" } });
    await expect(outsider.query(api.organizationFeatures.get, { workspaceId })).rejects.toThrow();
    expect(await outsider.query(api.organizationFeatures.get, {})).toEqual(off);
    // The directory of authors comes with Evidence Libraries.
    await expect(outsider.query(api.authors.profiles.list, { search: "", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(/FORBIDDEN/);
  });
});

test("the creation picker and authorization use the same eligible organizations", async () => {
  const t = convexTest(schema, modules);
  const [first, second, memberOnly, disabled, foreign] = await t.run(
    async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "owner",
        email: "owner@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const ids = [];
      for (const name of [
        "Alpha",
        "Beta",
        "Member only",
        "Disabled",
        "Foreign",
      ]) {
        const id = await seedOrganizationFeatures(
          ctx,
          name === "Foreign" ? ["someone-else"] : ["owner"],
          { evidenceLibraries: name !== "Disabled" },
        );
        await ctx.db.patch("organizations", id, { name });
        const membership = await ctx.db
          .query("organizationMemberships")
          .withIndex("by_organizationId_and_state", (q) =>
            q.eq("organizationId", id).eq("state", "active"),
          )
          .unique();
        await ctx.db.patch("organizationMemberships", membership!._id, {
          role: name === "Member only" ? "org:member" : "org:admin",
        });
        ids.push(id);
      }
      return ids;
    },
  );
  const owner = t.withIdentity({
    subject: "owner",
    o: { id: "unrelated", rol: "org:member" },
  });
  expect(
    ((await owner.query(api.organizationFeatures.listLibraryOrganizations, {})).page).map(
      (org) => org.id,
    ),
  ).toEqual([first, second]);
  const { requireLibraryOrganization } = await import("./organizationFeatures");
  const { createEvidenceLibrarySetup } =
    await import("./evidenceLibraries/mutations");
  const created = await owner.run((ctx) =>
    createEvidenceLibrarySetup(ctx, {
      organizationId: second!,
      name: "Chosen library",
      slug: "chosen-library",
      publicAddress: "https://chosen.example.org",
    }),
  );
  expect(
    await t.run((ctx) => ctx.db.get("evidenceLibraries", created.libraryId)),
  ).toMatchObject({ workspaceId: await t.run((ctx) => organizationWorkspaceOf(ctx, second!)) });
  for (const id of [memberOnly, disabled, foreign])
    await expect(
      owner.run((ctx) => requireLibraryOrganization(ctx, id!)),
    ).rejects.toThrow(/FORBIDDEN/);
  await t.run((ctx) => planGrants(ctx, second!, []));
  expect(
    ((await owner.query(api.organizationFeatures.listLibraryOrganizations, {})).page).map(
      (org) => org.id,
    ),
  ).toEqual([first]);
  await expect(
    owner.run((ctx) => requireLibraryOrganization(ctx, second!)),
  ).rejects.toThrow(/FORBIDDEN/);
});

test("refuses to read a person in more organizations than one read takes, not a partial list (#427)", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedFeatureUser(ctx, "joiner");
    for (let i = 0; i < MAX_ORGANIZATIONS_PER_PERSON; i += 1) await seedOrganizationFeatures(ctx, ["joiner"], { evidenceLibraries: true });
  });
  const joiner = t.withIdentity({ subject: "joiner" });
  // A member of each and an admin of none: nowhere to make a library, and all of them read.
  expect((await joiner.query(api.organizationFeatures.listLibraryOrganizations, {})).page).toEqual([]);
  await t.run((ctx) => seedOrganizationFeatures(ctx, ["joiner"], { evidenceLibraries: true }));
  await expect(joiner.query(api.organizationFeatures.listLibraryOrganizations, {})).rejects.toThrow(/more than 200 organizations/);
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
