// An organization on Team and off it (#652): only its admins move it, Team first saves a card when it has none, Free takes up to
// FREE_MEMBERS members, Clerk's member limit follows the plan, and an organization that's gone keeps neither seats nor Team.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { FREE_MEMBERS, ORGANIZATION_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { FAKE_SEAT_CREDITS, fakeAutumn, fakeAutumnFetch } from "./billing.test-support";

/** The member limits set on organizations in Clerk, in order. */
let limits: Array<{ organization: string; limit: number }> = [];

beforeEach(() => {
  fakeAutumn.reset();
  limits = [];
  vi.stubGlobal(
    "fetch",
    fakeAutumnFetch(async (input, init) => {
      const organization = String(input).match(/api\.clerk\.com\/v1\/organizations\/([^/]+)$/)?.[1];
      if (!organization || init?.method !== "PATCH") throw new Error(`unexpected fetch ${String(input)}`);
      limits.push({ organization, limit: JSON.parse(String(init.body)).max_allowed_memberships });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

  await expect(t.withIdentity({ subject: "user_ben" }).action(api.billing.actions.moveToTeam, { workspaceId })).rejects.toThrow();
  fakeAutumn.noCard = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId })).toEqual({ url: "https://setup.test" });
  // Autumn moves it once the card is saved; nothing is attached before.
  expect(fakeAutumn.calls.find((call) => call.path === "billing.setup_payment")?.body).toMatchObject({ customer_id: workspaceId, plan_id: TEAM_PLAN });
  expect(moves()).toBe(0);

  // A card that asks to confirm a seat's payment sends the admin to its page; once paid, the next sync seats everyone.
  fakeAutumn.noCard = false;
  fakeAutumn.confirmPayments = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId })).toEqual({ url: "https://checkout.test" });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(TEAM_PLAN);
  fakeAutumn.confirmPayments = false;
  await t.action(internal.billing.seats.sync, { workspaceId });
  expect(fakeAutumn.balance(workspaceId)).toBe(2 * FAKE_SEAT_CREDITS);
  expect(await ada.query(api.billing.seats.counts, { workspaceId })).toEqual({ members: 2, seats: 2 });
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toMatchObject({ plan: TEAM_PLAN, card: { last4: "4242" } });
  // Team has no member limit in Clerk, set once however often its seats sync.
  expect(limits).toEqual([{ organization: "org_lab", limit: 0 }]);

  for (const who of people.slice(2)) await membership(who, true);
  expect(limits).toHaveLength(1);
  expect(people.length).toBeGreaterThan(FREE_MEMBERS);
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow();
  expect(fakeAutumn.customer(workspaceId).planId).toBe(TEAM_PLAN);

  await membership("fy", false);
  await ada.action(api.billing.actions.moveToFree, { workspaceId });
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  expect(seated()).toEqual([]);
  expect(limits.at(-1)).toEqual({ organization: "org_lab", limit: FREE_MEMBERS });
});

it("ends the seats and Team of an organization deleted in Clerk, after its workspace is gone", async () => {
  const { t, workspaceId, membership, deleted, seated, ada } = await lab(["ada", "ben"]);
  await membership("ada", true, "org:admin");
  await membership("ben", true);
  await ada.action(api.billing.actions.moveToTeam, { workspaceId });
  expect(seated()).toEqual(["user_ada", "user_ben"]);

  // Deleted in Clerk's dashboard rather than here: its webhook closes it, and its workspace is purged, account and all.
  await deleted();
  expect(await t.run((ctx) => ctx.db.get("workspaces", workspaceId))).toBeNull();

  // The daily check still finds the seats it holds, ends them, and cancels its Team plan.
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(seated()).toEqual([]);
  expect(fakeAutumn.customer(workspaceId).planId).toBe(ORGANIZATION_PLAN);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())).toBeNull();
});
