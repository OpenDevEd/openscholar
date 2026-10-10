// An organization on Team and off it (#652): only its admins move it, Team first saves a card when it has none, Free takes up to
// FREE_MEMBERS members, Clerk's member limit follows the plan, and an organization that's gone keeps neither seats nor Team.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { FREE_MEMBERS, ORGANIZATION_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { FAKE_SEAT_CREDITS, fakeAutumn, installFakeAutumn } from "./billing.test-support";

beforeEach(() => {
  installFakeAutumn();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const limits = () => fakeAutumn.memberLimits;

const ORGANIZATION = { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1 };

/** A lab organization on the free plan, its people, and Clerk's webhooks for them. */
async function lab(people: string[]) {
  const t = convexTest(schema);
  const workspaceId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { ...ORGANIZATION, state: "active", createdAt: 1, updatedAt: 1 });
    for (const who of people) await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
  });
  fakeAutumn.customer(workspaceId).planId = ORGANIZATION_PLAN;
  let at = 10;
  /** A Clerk membership webhook for `who` in the lab. */
  const membership = async (who: string, joined: boolean, role: "org:admin" | "org:member" = "org:member") => {
    await t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}_${++at}`, eventType: joined ? "organizationMembership.created" : "organizationMembership.deleted", instanceId: "ins_test", occurredAt: at, payloadSha256: `sha_${at}`,
      action: joined ? "upsert" : "delete",
      membership: { clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role, state: joined ? "active" : "revoked", clerkCreatedAt: 1, clerkUpdatedAt: at, organization: ORGANIZATION },
    });
    await t.finishAllScheduledFunctions(() => {});
  };
  /** Clerk's webhook for the lab's deletion. */
  const deleted = async () => {
    await t.mutation(internal.webhooks.projections.applyOrganizationEvent, { eventId: `evt_deleted_${++at}`, eventType: "organization.deleted", instanceId: "ins_test", occurredAt: at, payloadSha256: `sha_${at}`, action: "delete", entityId: "org_lab" });
    await t.finishAllScheduledFunctions(() => {});
  };
  const seated = () => [...fakeAutumn.entitiesOf(workspaceId)].filter(([, entity]) => entity.seated).map(([id]) => id).sort();
  return { t, workspaceId, membership, deleted, seated, ada: t.withIdentity({ subject: "user_ada" }) };
}

it("moves an organization to Team for its admin, saving a card or confirming a payment first, and back to Free once it has few enough members", async () => {
  const people = ["ada", "ben", "cy", "di", "ed", "fy"];
  const { t, workspaceId, membership, seated, ada } = await lab(people);
  const moves = () => fakeAutumn.calls.filter((call) => call.path === "billing.attach" && !call.body.entity_id).length;
  await membership("ada", true, "org:admin");
  await membership("ben", true);

  await expect(t.withIdentity({ subject: "user_ben" }).action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).rejects.toThrow();
  // The admin agreed to a charge for the members they were shown; a different count now is asked again.
  await expect(ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 3 })).rejects.toThrow(/confirm again/);
  fakeAutumn.noCard = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).toEqual({ url: "https://setup.test" });
  // Autumn moves it once the card is saved; nothing is attached before.
  expect(fakeAutumn.calls.find((call) => call.path === "billing.setup_payment")?.body).toMatchObject({ customer_id: workspaceId, plan_id: TEAM_PLAN });
  expect(moves()).toBe(0);

  // While another sync of it runs, the move waits for it, so a payment page never goes to a sync nobody's watching.
  fakeAutumn.noCard = false;
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(true);
  await expect(ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).rejects.toThrow(/being updated/);
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  await t.mutation(internal.billing.seats.release, { workspaceId });

  // A card that asks to confirm a seat's payment sends the admin to its page; once paid, the next sync seats everyone.
  fakeAutumn.confirmPayments = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).toEqual({ url: "https://checkout.test" });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(TEAM_PLAN);
  fakeAutumn.confirmPayments = false;
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.balance(workspaceId)).toBe(2 * FAKE_SEAT_CREDITS);
  expect(await ada.query(api.billing.seats.counts, { workspaceId })).toEqual({ members: 2, invitations: 0, seats: 2 });
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toMatchObject({ plan: TEAM_PLAN, card: { last4: "4242" } });
  // Team has no member limit in Clerk, set once however often its seats sync.
  expect(limits()).toEqual([{ organization: "org_lab", limit: 0 }]);

  for (const who of people.slice(2)) await membership(who, true);
  expect(limits()).toHaveLength(1);
  expect(people.length).toBeGreaterThan(FREE_MEMBERS);
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow();
  expect(fakeAutumn.customer(workspaceId).planId).toBe(TEAM_PLAN);

  await membership("fy", false);
  // Free has room for FREE_MEMBERS, invitations included.
  const invitation = await t.run(async (ctx) => ctx.db.insert("organizationInvitations", { clerkInvitationId: "inv_1", organizationId: (await ctx.db.query("organizations").first())!._id, email: "gus@lab.test", role: "org:member", state: "pending", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 }));
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow(/invitations included/);
  await t.run((ctx) => ctx.db.delete("organizationInvitations", invitation));
  await ada.action(api.billing.actions.moveToFree, { workspaceId });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  expect(seated()).toEqual([]);
  expect(limits().at(-1)).toEqual({ organization: "org_lab", limit: FREE_MEMBERS });
});

it("ends the seats and Team of an organization deleted in Clerk, after its workspace is gone and whatever its seats were last counted as", async () => {
  const { t, workspaceId, membership, deleted, seated, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 });
  expect(seated()).toEqual(["user_ada", "user_ben"]);
  // A sync that failed partway left its row counting none.
  await t.run(async (ctx) => ctx.db.patch("seatSyncs", (await ctx.db.query("seatSyncs").first())!._id, { seats: 0 }));

  // Deleted in Clerk's dashboard rather than here, while Autumn is down: its webhook closes it, and its workspace is purged, account and all.
  fakeAutumn.failNext = "entities.list";
  await deleted();
  expect(await t.run((ctx) => ctx.db.get("workspaces", workspaceId))).toBeNull();
  expect(seated()).toEqual(["user_ada", "user_ben"]);

  // The daily check still finds it, ends its seats, cancels its Team plan, and lets it go.
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(seated()).toEqual([]);
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  expect(await t.run((ctx) => ctx.db.query("seatSyncs").withIndex("by_ending", (q) => q.eq("ending", true)).collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toBeNull();
});

it("ends Team only while no other sync of the organization runs", async () => {
  const { t, workspaceId, membership, seated, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 });
  // A sync that read Team a moment ago could still seat someone: moving off Team waits for it.
  expect(await t.mutation(internal.billing.seats.claim, { workspaceId })).toBe(true);
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow(/being updated/);
  expect(fakeAutumn.customer(workspaceId).planId).toBe(TEAM_PLAN);
  await t.mutation(internal.billing.seats.release, { workspaceId });
  await t.finishAllScheduledFunctions(() => {});
  await ada.action(api.billing.actions.moveToFree, { workspaceId });
  expect(seated()).toEqual([]);
});

it("tries again later to set a member limit Clerk refused", async () => {
  vi.useFakeTimers();
  try {
    const { t, workspaceId, membership, ada } = await lab(["ada"]);
    await membership("ada", true, "org:admin");
    fakeAutumn.refuseLimits = 1;
    await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 1 });
    expect(limits()).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(limits()).toEqual([{ organization: "org_lab", limit: 0 }]);
  } finally {
    vi.useRealTimers();
  }
});
