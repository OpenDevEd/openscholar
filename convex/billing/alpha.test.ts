// The public alpha (`subscriptions.team` off): no seats are sold, an organization has no member limit and has member caps
// through entities with no seat, a plan given by request can't be bought or lost to a sync, and Evidence Libraries are a
// switch on the organization that leaves its plan as it is.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ORGANIZATION_PLAN, SEAT_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { fakeAutumn, installFakeAutumn } from "./billing.test-support";

beforeEach(() => {
  installFakeAutumn();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PLAN = { addOn: false, features: [], popular: false, limits: {} };

/** An organization on the free plan with `ada` its admin, `ben` a member and `zed` one of OpenScholar's admins. */
async function lab() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const person = (name: string) => ctx.db.insert("users", { clerkId: `user_${name}`, email: `${name}@lab.test`, firstName: name, state: "active", createdAt: 1, updatedAt: 1 } as never);
    const [ada, ben, zed] = [await person("ada"), await person("ben"), await person("zed")];
    await ctx.db.insert("admins", { email: "zed@lab.test", userId: zed, createdAt: 1 } as never);
    for (const [name, role] of [["ada", "org:admin"], ["ben", "org:member"]]) await ctx.db.insert("organizationMemberships", { clerkMembershipId: `mem_${name}`, clerkUserId: `user_${name}`, organizationId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("billingCatalog", { plans: [{ ...PLAN, id: "free", name: "Free", autoEnable: true }, { ...PLAN, id: "southern", name: "Southern", autoEnable: false, byRequest: true }, { ...PLAN, id: TEAM_PLAN, name: "Team", autoEnable: false }, { ...PLAN, id: SEAT_PLAN, name: "Seat", autoEnable: false, price: { amount: 24, interval: "month" } }, { ...PLAN, id: ORGANIZATION_PLAN, name: "Free", autoEnable: false }], features: [], syncedAt: 1 } as never);
    const workspaceId = (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
    return { organizationId, workspaceId, ada, ben, zed };
  });
  fakeAutumn.customer(ids.workspaceId).planId = ORGANIZATION_PLAN;
  const as = (name: string) => t.withIdentity({ subject: `user_${name}` });
  return { t, as, ...ids };
}

it("sells no seats, and refuses a plan given by request to anyone who tries to buy it", async () => {
  const { as, workspaceId } = await lab();
  await expect(as("ada").action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).rejects.toThrow(/isn't on sale/);
  await expect(as("ada").action(api.billing.actions.previewTeam, { workspaceId, seats: 2 })).rejects.toThrow(/isn't on sale/);
  await expect(as("ada").action(api.billing.actions.changeSeats, { workspaceId, seats: 5 })).rejects.toThrow(/aren't on sale/);
  await expect(as("ada").action(api.billing.actions.previewSeats, { workspaceId, seats: 5 })).rejects.toThrow(/isn't on sale/);
  await expect(as("ben").action(api.billing.actions.choosePlan, { plan: "southern" })).rejects.toThrow(/No plan/);
  await expect(as("ben").action(api.billing.actions.previewPlan, { plan: "southern" })).rejects.toThrow(/No plan/);
});

it("gives each member an entity with no seat, lifts Clerk's member limit to what OpenScholar reads, and lets an admin cap a member", async () => {
  const { t, as, workspaceId, ben } = await lab();
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.memberLimits.at(-1)?.limit).toBe(MAX_ORGANIZATION_MEMBERS);
  const entities = fakeAutumn.customer(workspaceId);
  expect(fakeAutumn.entities.get(workspaceId)?.get("user_ben")).toMatchObject({ seated: false });
  expect(entities.planId).toBe(ORGANIZATION_PLAN);
  await as("ada").action(api.billing.caps.setCap, { workspaceId, memberId: ben, cap: 500 });
  expect(fakeAutumn.entities.get(workspaceId)?.get("user_ben")?.cap).toBe(500);
  expect(await t.run((ctx) => ctx.db.query("memberCaps").first())).toMatchObject({ cap: 500 });
  // Someone who leaves takes their entity with them, and a sync changes nothing the second time.
  await t.run(async (ctx) => ctx.db.patch("organizationMemberships", (await ctx.db.query("organizationMemberships").filter((q) => q.eq(q.field("clerkUserId"), "user_ben")).first())!._id, { state: "revoked" } as never));
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.entities.get(workspaceId)?.has("user_ben")).toBe(false);
});

it("leaves a plan given by request where it is, and takes no invitations back while there is room", async () => {
  const { t, workspaceId, organizationId } = await lab();
  fakeAutumn.customer(workspaceId).planId = "southern";
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.customer(workspaceId).planId).toBe("southern");
  const sent = Array.from({ length: 12 }, (_, i) => `inv_${i}`);
  await t.run(async (ctx) => {
    for (const id of sent) await ctx.db.insert("organizationInvitations", { clerkInvitationId: id, organizationId, email: `${id}@lab.test`, role: "org:member", state: "pending", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 } as never);
  });
  expect(await t.query(internal.organizations.read.pastRoom, { workspaceId, sent })).toEqual([]);
});

it("switches Evidence Libraries on for an organization without touching its plan, for OpenScholar's admins alone", async () => {
  const { t, as, organizationId, workspaceId, zed, ada } = await lab();
  const opens = () => as("ada").query(api.organizationFeatures.opens, { workspaceId });
  expect(await opens()).toMatchObject({ evidenceLibraries: false, authors: false });
  await expect(as("ada").mutation(api.organizations.libraryAccess.set, { organizationId, on: true })).rejects.toThrow(/Admins only/);
  await as("zed").mutation(api.organizations.libraryAccess.set, { organizationId, on: true });
  expect(await opens()).toMatchObject({ evidenceLibraries: true, authors: true });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  const own = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", zed)).unique())!._id);
  const row = async (show: "all" | "on" | "off") => (await as("zed").query(api.organizations.libraryAccess.list, { workspaceId: own, show, paginationOpts: { cursor: null, numItems: 8 } })).page;
  expect(await row("on")).toEqual([expect.objectContaining({ name: "Lab", on: true, libraries: 0 })]);
  expect(await row("off")).toEqual([]);
  expect(await as("zed").query(api.organizations.libraryAccess.count, { workspaceId: own, show: "on" })).toBe(1);

  // A library it holds keeps the switch on, so nobody is shut out of one.
  await t.run((ctx) => ctx.db.insert("evidenceLibraries", { workspaceId, name: "Reading", slug: "reading", state: "active", createdBy: ada, createdByClerkUserId: "user_ada", updatedByClerkUserId: "user_ada", createdAt: 1, updatedAt: 1 } as never));
  await expect(as("zed").mutation(api.organizations.libraryAccess.set, { organizationId, on: false })).rejects.toThrow(/Move or delete/);
  await t.run(async (ctx) => ctx.db.delete("evidenceLibraries", (await ctx.db.query("evidenceLibraries").first())!._id));
  await as("zed").mutation(api.organizations.libraryAccess.set, { organizationId, on: false });
  expect(await opens()).toMatchObject({ evidenceLibraries: false });
  await expect(as("ada").query(api.organizations.libraryAccess.list, { workspaceId, paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow(/Admins only/);
});

it("switches libraries on for the organizations on Team, so moving them off it takes nothing away", async () => {
  const { t, as, workspaceId } = await lab();
  await t.run((ctx) => ctx.db.insert("billingAccounts", { workspaceId, plan: TEAM_PLAN, pastDue: false, balance: 0, purchased: 0, refreshedAt: 1, signupGranted: false, hasPaid: true } as never));
  expect(await t.mutation(internal.organizations.libraryAccess.switchOnPlanHolders, {})).toBe(1);
  await t.run(async (ctx) => ctx.db.patch("billingAccounts", (await ctx.db.query("billingAccounts").first())!._id, { plan: ORGANIZATION_PLAN }));
  expect(await as("ada").query(api.organizationFeatures.opens, { workspaceId })).toMatchObject({ evidenceLibraries: true });
});
