// An organization on Team and off it (#652, #862): only its admins move it and change its seats, Team is bought with a seat for at least
// each member and invitation, Free takes up to FREE_MEMBERS members at the renewal, Clerk's member limit follows the seats, and an
// organization that's gone keeps neither seats nor Team.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { FREE_MEMBERS, ORGANIZATION_PLAN, SEAT_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
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

const ORGANIZATION = { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1 };

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

/** An invitation to the lab waiting for an answer. */
const invite = (t: Awaited<ReturnType<typeof lab>>["t"], email: string) =>
  t.run(async (ctx) => ctx.db.insert("organizationInvitations", { clerkInvitationId: `inv_${email}`, organizationId: (await ctx.db.query("organizations").first())!._id, email, role: "org:member", state: "pending", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 }));

it("moves an organization to Team for its admin with the seats they pick, in one charge, at least one for each member and invitation", async () => {
  const { t, workspaceId, membership, seated, ada } = await lab(["ada", "ben"]);
  const moves = () => fakeAutumn.calls.filter((call) => call.path === "billing.attach" && call.body.plan_id === TEAM_PLAN);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await invite(t, "gus@lab.test");

  await expect(t.withIdentity({ subject: "user_ben" }).action(api.billing.actions.moveToTeam, { workspaceId, seats: 4 })).rejects.toThrow();
  // Two members and an invitation take three seats.
  await expect(ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 })).rejects.toThrow(/confirm again/);
  expect(await ada.action(api.billing.actions.previewTeam, { workspaceId, seats: 4 })).toMatchObject({ dueNow: 96, renewsAt: expect.any(Number) });

  // Without a saved card, Stripe's page takes the payment, after which Autumn moves it; a declined card changes nothing.
  fakeAutumn.noCard = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 4 })).toEqual({ url: "https://checkout.test" });
  fakeAutumn.noCard = false;
  fakeAutumn.declineCard = true;
  await expect(ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 4 })).rejects.toThrow(/declined/);
  fakeAutumn.declineCard = false;
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);

  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 4 })).toEqual({ url: null });
  expect(moves().at(-1)?.body.license_quantities).toEqual([{ license_plan_id: SEAT_PLAN, quantity: 4 }]);
  expect(seated()).toEqual(["user_ada", "user_ben"]);
  expect(fakeAutumn.balance(workspaceId)).toBe(4 * FAKE_SEAT_CREDITS);
  expect(await ada.query(api.billing.seats.counts, { workspaceId })).toEqual({ members: 2, invitations: 1, seats: 4, held: 0 });
  expect(limits().at(-1)).toEqual({ organization: "org_lab", limit: 4 });
});

it("changes an organization's seats down to those in use, and a declined card changes nothing", async () => {
  const { t, workspaceId, membership, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await invite(t, "gus@lab.test");
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 3 });
  const seats = async () => (await ada.query(api.billing.seats.counts, { workspaceId }))?.seats;

  expect(await ada.action(api.billing.actions.previewSeats, { workspaceId, seats: 5 })).toMatchObject({ dueNow: 48 });
  await ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 5 });
  expect(await seats()).toBe(5);
  expect(limits().at(-1)?.limit).toBe(5);
  // Two members and an invitation are three seats in use.
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 2 })).rejects.toThrow(/in use/);
  // Clerk must hold invitations to the fewer seats first: refused, the seats stay as they are.
  fakeAutumn.refuseLimits = 1;
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 3 })).rejects.toThrow();
  expect(await seats()).toBe(5);
  await ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 3 });
  expect(await seats()).toBe(3);
  fakeAutumn.declineCard = true;
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 4 })).rejects.toThrow(/declined/);
  expect(await seats()).toBe(3);
  await expect(t.withIdentity({ subject: "user_ben" }).action(api.billing.actions.changeSeats, { workspaceId, seats: 4 })).rejects.toThrow();
});

it("counts an invitation Clerk took that hasn't reached the projections yet when an organization's seats go down", async () => {
  const { t, workspaceId, membership, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 4 });
  // Another admin invited two people a moment ago: Clerk has them, the projections don't yet (#858).
  fakeAutumn.clerkCounts.set("org_lab", { members: 2, invitations: 2 });
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 3 })).rejects.toThrow(/4 seats are in use/);
  expect((await ada.query(api.billing.seats.counts, { workspaceId }))?.seats).toBe(4);
  expect(limits().at(-1)?.limit).toBe(4);
  // One of them has just accepted: a member to Clerk, still an invitation here. They're counted once.
  await invite(t, "gus@lab.test");
  fakeAutumn.clerkCounts.set("org_lab", { members: 3, invitations: 0 });
  await ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 3 });
  expect((await ada.query(api.billing.seats.counts, { workspaceId }))?.seats).toBe(3);
});

it("makes one purchase of a workspace at a time, and lets go when it ends", async () => {
  const { t, workspaceId, membership, ada } = await lab(["ada"]);
  await membership("ada", true, "org:admin");
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 1 });
  // Another purchase of the lab's is under way (#858): this one is refused and buys nothing.
  const since = await t.mutation(internal.billing.purchases.claim, { workspaceId });
  expect(since).toEqual(expect.any(Number));
  const before = fakeAutumn.calls.length;
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 2 })).rejects.toThrow(/BILLING_PLAN_CHANGE_CONFLICT/);
  expect(fakeAutumn.calls.slice(before).filter((call) => call.path.startsWith("billing."))).toEqual([]);
  // Only the purchase that took the lock lets go of it.
  await t.mutation(internal.billing.purchases.release, { workspaceId, since: since! - 1 });
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 2 })).rejects.toThrow(/BILLING_PLAN_CHANGE_CONFLICT/);
  await t.mutation(internal.billing.purchases.release, { workspaceId, since: since! });
  await ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 2 });
  expect((await ada.query(api.billing.seats.counts, { workspaceId }))?.seats).toBe(2);
  fakeAutumn.declineCard = true;
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 3 })).rejects.toThrow(/declined/);
  expect(await t.run((ctx) => ctx.db.query("purchaseLocks").collect())).toEqual([]);
});

it("buys nothing for an organization while a payment is still open, and says where to pay it", async () => {
  const { t, workspaceId, membership, ada } = await lab(["ada"]);
  await membership("ada", true, "org:admin");
  await t.run((ctx) => ctx.db.insert("billingCatalog", { plans: [{ id: "top_up", name: "Credit top-up", addOn: true, autoEnable: false, credits: { included: 0, interval: "one_off", unitPrice: { amount: 1, billingUnits: 10_000 } }, features: [], popular: false }], features: [], syncedAt: Date.now() }));
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 1 });
  // A seat bought a moment ago was declined (#858): its invoice stays open until Autumn voids it, and Autumn would give a seat asked for meanwhile for nothing.
  fakeAutumn.customer(workspaceId).invoices = [{ plan_ids: [TEAM_PLAN], status: "open", total: 24, currency: "usd", created_at: 1, hosted_invoice_url: "https://pay.test/in_seat" }];
  const charges = () => fakeAutumn.calls.filter((call) => ["billing.attach", "billing.update"].includes(call.path)).length;
  const before = charges();
  for (const attempt of [
    () => ada.action(api.billing.actions.previewSeats, { workspaceId, seats: 2 }),
    () => ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 2 }),
    () => ada.action(api.organizations.manage.invite, { workspaceId, emails: ["gus@lab.test"], role: "member", addSeat: true }),
    () => ada.action(api.billing.actions.buyCredits, { workspaceId, credits: 10_000 }),
    () => ada.action(api.billing.actions.moveToFree, { workspaceId }),
  ]) await expect(attempt()).rejects.toThrow(/BILLING_PAYMENT_OPEN[^]*pay\.test\/in_seat/);
  expect(charges()).toBe(before);
  expect((await ada.query(api.billing.seats.counts, { workspaceId }))?.seats).toBe(1);
});

it("moves an organization on Team to Free at its renewal once it has few enough members, and its admin can keep Team instead", async () => {
  const people = ["ada", "ben", "cy", "di", "ed", "fy"];
  const { t, workspaceId, membership, ada } = await lab(people);
  for (const [i, who] of people.entries()) await membership(who, true, i === 0 ? "org:admin" : "org:member");
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 6 });
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow(/invitations included/);
  expect(fakeAutumn.customer(workspaceId).next).toBeUndefined();
  // Back to Team's seats once the move is refused.
  await t.finishAllScheduledFunctions(() => {});
  expect(limits().at(-1)?.limit).toBe(6);

  await membership("fy", false);
  await ada.action(api.billing.actions.moveToFree, { workspaceId });
  // It keeps Team and its seats to the renewal; Clerk holds it to Free's members from now, through the syncs before it.
  expect(fakeAutumn.customer(workspaceId)).toMatchObject({ planId: TEAM_PLAN, next: ORGANIZATION_PLAN });
  expect(limits().at(-1)?.limit).toBe(FREE_MEMBERS);
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(limits().at(-1)?.limit).toBe(FREE_MEMBERS);
  await expect(ada.action(api.billing.actions.changeSeats, { workspaceId, seats: 7 })).rejects.toThrow(/Keep Team/);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toMatchObject({ plan: TEAM_PLAN, changesAt: expect.any(Number), nextPlan: ORGANIZATION_PLAN });

  await ada.action(api.billing.actions.keepPlan, { workspaceId });
  expect(fakeAutumn.customer(workspaceId).next).toBeUndefined();
  expect(limits().at(-1)?.limit).toBe(6);
});

it("moves an organization whose Team payment Stripe gave up on to the free organization plan", async () => {
  const { t, workspaceId, membership, seated, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 });
  // Stripe cancels the unpaid subscription; Autumn ends Team and its seats, and gives the customer its default plan back.
  Object.assign(fakeAutumn.customer(workspaceId), { planId: "free", seats: 0 });
  for (const entity of fakeAutumn.entitiesOf(workspaceId).values()) entity.seated = false;
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  expect(seated()).toEqual([]);
  expect(fakeAutumn.entitiesOf(workspaceId).size).toBe(0);
  expect(limits().at(-1)?.limit).toBe(FREE_MEMBERS);
});

it("shows an organization's failed payment to its members, and where to pay it to its admins", async () => {
  const { t, workspaceId, membership, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 });
  Object.assign(fakeAutumn.customer(workspaceId), { pastDue: true, invoices: [{ plan_ids: [TEAM_PLAN], status: "open", total: 48, currency: "usd", created_at: 5_000, hosted_invoice_url: "https://pay.test/in_team" }] });
  await t.action(internal.billing.accounts.refresh, { workspaceId });
  expect((await ada.query(api.billing.accounts.mine, { workspaceId }))?.unpaid).toEqual({ amount: 48, currency: "usd", since: 5_000, url: "https://pay.test/in_team" });
  expect((await t.withIdentity({ subject: "user_ben" }).query(api.billing.accounts.mine, { workspaceId }))?.unpaid).toEqual({ amount: 48, currency: "usd", since: 5_000 });
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
  fakeAutumn.failNext = "licenses.list_assignments";
  await deleted();
  expect(await t.run((ctx) => ctx.db.get("workspaces", workspaceId))).toBeNull();
  expect(seated()).toEqual(["user_ada", "user_ben"]);

  // The daily check still finds it, cancels its Team plan at once, removes its entities, and lets it go.
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(seated()).toEqual([]);
  expect(fakeAutumn.customer(workspaceId).planId).not.toBe(TEAM_PLAN);
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(fakeAutumn.entitiesOf(workspaceId).size).toBe(0);
  expect(await t.run((ctx) => ctx.db.query("seatSyncs").withIndex("by_ending", (q) => q.eq("ending", true)).collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toBeNull();
});

it("tries again later to set a member limit Clerk refused", async () => {
  vi.useFakeTimers();
  try {
    const { t, workspaceId, membership, ada } = await lab(["ada"]);
    await membership("ada", true, "org:admin");
    fakeAutumn.refuseLimits = 1;
    await ada.action(api.billing.actions.moveToTeam, { workspaceId, seats: 2 });
    expect(limits()).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(limits()).toEqual([{ organization: "org_lab", limit: 2 }]);
  } finally {
    vi.useRealTimers();
  }
});
