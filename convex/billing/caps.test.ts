// Members' spending and the caps admins set on it on Team (#652).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { ORGANIZATION_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { fakeAutumn, installFakeAutumn, seedCreditsForTest } from "./billing.test-support";
import { insertUsage } from "./ledger";

// The ledger worker counts charges on whichever timers are active when they're recorded.
beforeEach(() => {
  vi.useFakeTimers();
  installFakeAutumn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function lab() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
    const person = (who: string) => ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    const ada = await person("ada");
    const ben = await person("ben");
    await seedCreditsForTest(ctx, { workspaceId, free: 50_000 });
    return { workspaceId, ada, ben };
  });
  for (const [who, role] of [["ada", "org:admin"], ["ben", "org:member"]] as const) {
    await t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}`, eventType: "organizationMembership.created", instanceId: "ins_test", occurredAt: 2, payloadSha256: `sha_${who}`, action: "upsert",
      membership: { clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 2, organization: { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1 } },
    });
  }
  /** Puts the lab on a plan, in Autumn and in its cached account. */
  const plan = (id: string) => t.run(async (ctx) => {
    fakeAutumn.customer(ids.workspaceId).planId = id;
    const account = (await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", ids.workspaceId)).unique())!;
    await ctx.db.patch("billingAccounts", account._id, { plan: id });
  });
  const spend = (userId: Id<"users">, credits: number, createdAt: number) =>
    t.run(async (ctx) => {
      await insertUsage(ctx, { userId, workspaceId: ids.workspaceId, chargeId: `charge-${userId}-${createdAt}`, credits, kind: "search", description: "a search", createdAt });
    });
  const hold = (userId: Id<"users">, credits: number) =>
    t.mutation(internal.billing.charge.hold, { userId, workspaceId: ids.workspaceId, chargeId: `hold-${crypto.randomUUID()}`, credits, expiresAt: Date.now() + 60_000 });
  return { t, ...ids, plan, spend, hold, adaAs: t.withIdentity({ subject: "user_ada" }), benAs: t.withIdentity({ subject: "user_ben" }) };
}

it("refuses a hold that would take a capped member past their cap, counting this month's spending and their open holds", async () => {
  const { t, workspaceId, ada, ben, plan, spend, hold, adaAs, benAs } = await lab();
  await plan(TEAM_PLAN);
  const { undo } = await adaAs.mutation(api.billing.caps.setCap, { workspaceId, userId: ben, cap: 1_000 });
  await spend(ben, 600, Date.now());
  // Last month's spending doesn't count.
  await spend(ben, 5_000, Date.now() - 40 * 86_400_000);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await benAs.query(api.billing.caps.allowance, { workspaceId })).toEqual({ spent: 600, cap: 1_000, total: 600 });
  expect((await adaAs.query(api.billing.caps.allowance, { workspaceId })).total).toBe(600);
  await hold(ben, 300);
  await expect(hold(ben, 200)).rejects.toThrow(/ask an admin to raise your cap/i);
  // The admin has no cap.
  await hold(ada, 20_000);

  // An admin sees everyone's spending, themselves first; a member sees their own.
  const everyone = await adaAs.query(api.billing.caps.spending, { workspaceId, paginationOpts: { cursor: null, numItems: 10 } });
  expect(everyone.page.map(({ name, you, spent, cap }) => ({ name, you, spent, cap }))).toEqual([
    { name: "ada", you: true, spent: 0, cap: undefined },
    { name: "ben", you: false, spent: 600, cap: 1_000 },
  ]);
  expect((await benAs.query(api.billing.caps.spending, { workspaceId, paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.name)).toEqual(["ben"]);

  // Undone, the cap comes off.
  await adaAs.mutation(api.billing.caps.setCap, { workspaceId, ...undo!.args });
  expect(await benAs.query(api.billing.caps.allowance, { workspaceId })).toEqual({ spent: 600, total: 600 });
  await hold(ben, 200);
});

it("keeps caps to Team, and to its admins", async () => {
  const { workspaceId, ben, plan, hold, adaAs, benAs } = await lab();
  await expect(adaAs.mutation(api.billing.caps.setCap, { workspaceId, userId: ben, cap: 500 })).rejects.toThrow(/Team plan/);
  await plan(TEAM_PLAN);
  await expect(benAs.mutation(api.billing.caps.setCap, { workspaceId, userId: ben, cap: 5_000 })).rejects.toThrow(/Only an admin/);
  await adaAs.mutation(api.billing.caps.setCap, { workspaceId, userId: ben, cap: 500 });
  await expect(hold(ben, 600)).rejects.toThrow(/raise your cap/);
  // Off Team, a cap set on it stops counting.
  await plan(ORGANIZATION_PLAN);
  expect(await benAs.query(api.billing.caps.allowance, { workspaceId })).toEqual({ spent: 0, total: 0 });
  await hold(ben, 600);
});
