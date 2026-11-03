// Team seats are bought and filled by members (#862, #863): a member who joins is given one of the seats bought, one who
// leaves frees theirs unless they spent credits this billing period, which holds it to the renewal, and off Team there are none.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { FREE_MEMBERS, ORGANIZATION_PLAN } from "../../lib/billing/plans";
import { fakeAutumn, installFakeAutumn, sellTeamForTest } from "./billing.test-support";

// The ledger worker counts charges on whichever timers are active when they're recorded.
beforeEach(() => {
  vi.useFakeTimers();
  installFakeAutumn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ORGANIZATION = { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1 };

it("gives members the seats bought, holds a leaver's seat to the renewal when they spent from it, and frees the rest", async () => {
  const t = convexTest(schema);
  await t.run(sellTeamForTest);
  const { lab, users } = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { ...ORGANIZATION, state: "active", createdAt: 1, updatedAt: 1 });
    const users: Record<string, Id<"users">> = {};
    for (const who of ["ada", "ben", "cy", "di"]) users[who] = await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    return { lab: (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id, users };
  });
  let at = 10;
  const membership = async (who: string, joined: boolean) => {
    await t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}_${++at}`, eventType: joined ? "organizationMembership.created" : "organizationMembership.deleted", instanceId: "ins_test", occurredAt: at, payloadSha256: `sha_${at}`,
      action: joined ? "upsert" : "delete",
      membership: { clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role: "org:member", state: joined ? "active" : "revoked", clerkCreatedAt: 1, clerkUpdatedAt: at, organization: ORGANIZATION },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const row = () => t.run((ctx) => ctx.db.query("seatSyncs").withIndex("by_workspace", (q) => q.eq("workspaceId", lab)).unique());
  const sync = async () => {
    await t.action(internal.billing.seats.sync, { workspaceId: lab });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const writes = () => fakeAutumn.calls.filter((call) => ["licenses.attach", "licenses.release", "entities.delete", "billing.attach", "billing.update"].includes(call.path)).length;
  const limit = () => fakeAutumn.memberLimits.at(-1)?.limit;

  await membership("ada", true);
  await membership("ben", true);
  fakeAutumn.team(lab, 3);
  await sync();
  expect(fakeAutumn.seated(lab)).toEqual(["user_ada", "user_ben"]);
  expect(await row()).toMatchObject({ seats: 3, held: 0 });
  // Clerk's limit counts members and invitations: the seats bought.
  expect(limit()).toBe(3);

  // Ben spends from his seat, then leaves: it stays his to the renewal, and nobody else can fill it.
  await t.action(internal.billing.charge.retrySettle, { userId: users.ben!, workspaceId: lab, chargeId: "charge:ben", credits: 300, usage: { kind: "search", description: "A search" }, attempt: 0 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await membership("ben", false);
  expect(fakeAutumn.seated(lab)).toEqual(["user_ada", "user_ben"]);
  expect(await row()).toMatchObject({ seats: 3, held: 1 });
  expect(limit()).toBe(2);

  // Cy takes the free seat. Di, joining past the seats in a race, waits for one, and her charges aren't made as a seat.
  await membership("cy", true);
  await membership("di", true);
  expect(fakeAutumn.seated(lab)).toEqual(["user_ada", "user_ben", "user_cy"]);
  expect(await t.run((ctx) => ctx.db.query("memberSeats").withIndex("by_workspace_and_member", (q) => q.eq("workspaceId", lab).eq("clerkUserId", "user_di")).unique())).toBeNull();
  // Di spends nothing until she has a seat.
  await expect(t.mutation(internal.billing.charge.hold, { userId: users.di!, workspaceId: lab, chargeId: "hold:di", credits: 10, expiresAt: Date.now() + 60_000 })).rejects.toThrow(/no free seat for you/);

  // Run again, nothing changes.
  const before = writes();
  await sync();
  expect(writes()).toBe(before);

  // A member who spent nothing frees their seat at once, and the one waiting takes it.
  await membership("cy", false);
  expect(fakeAutumn.seated(lab)).toEqual(["user_ada", "user_ben", "user_di"]);
  expect(fakeAutumn.entitiesOf(lab).has("user_cy")).toBe(false);

  // Once the period Ben spent in is over, his seat is freed and his entity goes.
  fakeAutumn.customer(lab).periodStart = Date.now() + 1;
  await vi.advanceTimersByTimeAsync(10);
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fakeAutumn.seated(lab)).toEqual(["user_ada", "user_di"]);
  expect(fakeAutumn.entitiesOf(lab).has("user_ben")).toBe(false);
  expect(await row()).toMatchObject({ seats: 3, held: 0 });
  expect(limit()).toBe(3);

  // Off Team, nobody holds a seat and the entities go; Free has room for FREE_MEMBERS, invitations included.
  fakeAutumn.customer(lab).planId = ORGANIZATION_PLAN;
  fakeAutumn.customer(lab).seats = 0;
  for (const entity of fakeAutumn.entitiesOf(lab).values()) entity.seated = false;
  await sync();
  expect(fakeAutumn.entitiesOf(lab).size).toBe(0);
  expect(await row()).toMatchObject({ seats: 0, held: 0 });
  expect(limit()).toBe(FREE_MEMBERS);
});

it("runs one sync of an organization at a time, and the one asked for meanwhile once after it", async () => {
  const t = convexTest(schema);
  await t.run(sellTeamForTest);
  const workspaceId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { ...ORGANIZATION, state: "active", createdAt: 1, updatedAt: 1 });
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
  });
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(true);
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(false);
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(false);
  await t.mutation(internal.billing.seats.release, { workspaceId, seats: 0 });
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.filter((job) => job.name.includes("seats:sync"))).toHaveLength(1);
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(true);
});

it("counts a member's charge the ledger hasn't counted yet, and a hold, as spending that keeps their seat", async () => {
  const t = convexTest(schema);
  await t.run(sellTeamForTest);
  const { lab, users } = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { ...ORGANIZATION, state: "active", createdAt: 1, updatedAt: 1 });
    const users: Record<string, Id<"users">> = {};
    for (const who of ["ada", "ben", "cy"]) users[who] = await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    return { lab: (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id, users };
  });
  const since = Date.now() - 1_000;
  await t.run(async (ctx) => {
    // Ben's charge is recorded and waits for the ledger worker; Cy holds credits for a reply under way.
    await ctx.db.insert("billingUsage", { userId: users.ben!, workspaceId: lab, chargeId: "charge:ben", credits: 40, kind: "chat", description: "A reply", createdAt: Date.now() });
    await ctx.db.insert("billingHolds", { userId: users.cy!, workspaceId: lab, chargeId: "hold:cy", credits: 100, release: await ctx.scheduler.runAfter(60_000, internal.billing.seats.sync, { workspaceId: lab }) });
  });
  expect(await t.query(internal.billing.seats.spentFrom, { workspaceId: lab, clerkUserIds: ["user_ada", "user_ben", "user_cy"], since })).toEqual(["user_ben", "user_cy"]);
});
