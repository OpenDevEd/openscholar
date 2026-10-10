// Moving an organization to Team and back (#652): only its admins do, Team first saves a card when it has none, and Free takes up to FREE_MEMBERS members.
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

it("moves an organization to Team for its admin, saving a card first, and back to Free once it has few enough members", async () => {
  const t = convexTest(schema);
  const people = ["ada", "ben", "cy", "di", "ed", "fy"];
  const lab = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const who of people) await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
  });
  let at = 10;
  /** A Clerk membership webhook for `who` in the lab. */
  const membership = async (who: string, joined: boolean, role: "org:admin" | "org:member" = "org:member") => {
    await t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}_${++at}`, eventType: joined ? "organizationMembership.created" : "organizationMembership.deleted", instanceId: "ins_test", occurredAt: at, payloadSha256: `sha_${at}`,
      action: joined ? "upsert" : "delete",
      membership: {
        clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role, state: joined ? "active" : "revoked", clerkCreatedAt: 1, clerkUpdatedAt: at,
        organization: { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1 },
      },
    });
    await t.finishAllScheduledFunctions(() => {});
  };
  const ada = t.withIdentity({ subject: "user_ada" });
  const moves = () => fakeAutumn.calls.filter((call) => call.path === "billing.attach" && !call.body.entity_id).length;
  fakeAutumn.customer(lab).planId = ORGANIZATION_PLAN;
  await membership("ada", true, "org:admin");
  await membership("ben", true);

  await expect(t.withIdentity({ subject: "user_ben" }).action(api.billing.actions.moveToTeam, { workspaceId: lab })).rejects.toThrow();
  fakeAutumn.noCard = true;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId: lab })).toEqual({ url: "https://setup.test" });
  // Autumn moves it once the card is saved; nothing is attached before.
  expect(fakeAutumn.calls.find((call) => call.path === "billing.setup_payment")?.body).toMatchObject({ customer_id: lab, plan_id: TEAM_PLAN });
  expect(moves()).toBe(0);

  fakeAutumn.noCard = false;
  expect(await ada.action(api.billing.actions.moveToTeam, { workspaceId: lab })).toEqual({ url: null });
  expect(fakeAutumn.customer(lab).planId).toBe(TEAM_PLAN);
  expect(fakeAutumn.balance(lab)).toBe(2 * FAKE_SEAT_CREDITS);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", lab)).unique())).toMatchObject({ plan: TEAM_PLAN, card: { last4: "4242" } });

  for (const who of people.slice(2)) await membership(who, true);
  expect(people.length).toBeGreaterThan(FREE_MEMBERS);
  await expect(ada.action(api.billing.actions.moveToFree, { workspaceId: lab })).rejects.toThrow();
  expect(fakeAutumn.customer(lab).planId).toBe(TEAM_PLAN);

  await membership("fy", false);
  await ada.action(api.billing.actions.moveToFree, { workspaceId: lab });
  expect(fakeAutumn.customer(lab).planId).toBe(ORGANIZATION_PLAN);
  expect([...fakeAutumn.entitiesOf(lab).values()].filter((entity) => entity.seated)).toEqual([]);
});
