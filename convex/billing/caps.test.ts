// Members' spending and the caps admins set on it on Team (#652): Autumn holds a member to their
// cap, as the usage limit on their seat, so what Convex must do is make their charges as that seat.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { monthStart } from "../../lib/billing/month";
import { fakeAutumn, installFakeAutumn, seedCreditsForTest } from "./billing.test-support";

// The ledger worker counts charges on whichever timers are active when they're recorded.
beforeEach(() => {
  vi.useFakeTimers();
  installFakeAutumn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const month = () => monthStart(Date.now());
const usage = { kind: "search" as const, description: "A search" };

async function lab(people: string[] = ["ada", "ben"]) {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const workspaceId = (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
    const users: Record<string, Id<"users">> = {};
    for (const who of people) users[who] = await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { workspaceId, free: 50_000 });
    return { workspaceId, users };
  });
  for (const [i, who] of people.entries()) {
    await t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}`, eventType: "organizationMembership.created", instanceId: "ins_test", occurredAt: 2, payloadSha256: `sha_${who}`, action: "upsert",
      membership: { clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role: i === 0 ? "org:admin" : "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 2, organization: { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1 } },
    });
  }
  const { workspaceId } = ids;
  /** Puts the lab on Team, in Autumn and in its cached account; `seats` also gives every member a seat. */
  const team = async ({ seats }: { seats: boolean }) => {
    fakeAutumn.customer(workspaceId).planId = TEAM_PLAN;
    await t.run(async (ctx) => {
      const account = (await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())!;
      await ctx.db.patch("billingAccounts", account._id, { plan: TEAM_PLAN });
    });
    if (seats) await t.action(internal.billing.seats.sync, { workspaceId });
  };
  const as = (who: string) => t.withIdentity({ subject: `user_${who}` });
  return { t, workspaceId, users: ids.users, team, as };
}

it("caps a member on their seat in Autumn, makes their holds and charges as that seat, and takes the cap off on undo", async () => {
  const { t, workspaceId, users, team, as } = await lab();
  await team({ seats: true });
  const { undo } = await as("ada").action(api.billing.caps.setCap, { workspaceId, memberId: users.ben, cap: 1_000 });
  expect(fakeAutumn.entitiesOf(workspaceId).get("user_ben")?.cap).toBe(1_000);

  expect(await t.mutation(internal.billing.charge.hold, { userId: users.ben, workspaceId, chargeId: "hold:ben", credits: 100, expiresAt: Date.now() + 60_000 })).toEqual({ customerId: workspaceId, entityId: "user_ben" });

  // A charge past the cap is made as the seat, so Autumn stops it at the cap.
  await t.action(internal.billing.charge.retrySettle, { userId: users.ben, workspaceId, chargeId: "charge:ben", credits: 1_500, usage, attempt: 0 });
  expect(fakeAutumn.calls.find((call) => call.path === "balances.track")?.body.entity_id).toBe("user_ben");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await as("ben").query(api.billing.caps.allowance, { workspaceId, month: month() })).toEqual({ spent: 1_000, cap: 1_000, total: 1_000 });

  await as("ada").action(api.billing.caps.setCap, { workspaceId, ...undo!.args });
  expect(fakeAutumn.entitiesOf(workspaceId).get("user_ben")?.cap).toBeUndefined();
  expect(await as("ben").query(api.billing.caps.allowance, { workspaceId, month: month() })).toEqual({ spent: 1_000, total: 1_000 });
});

it("keeps caps to Team, to its admins, and to members holding a seat", async () => {
  const { workspaceId, users, team, as } = await lab();
  await expect(as("ada").action(api.billing.caps.setCap, { workspaceId, memberId: users.ben, cap: 500 })).rejects.toThrow(/Team plan/);
  await team({ seats: false });
  await expect(as("ada").action(api.billing.caps.setCap, { workspaceId, memberId: users.ben, cap: 500 })).rejects.toThrow(/with a seat yet/);
  await expect(as("ben").action(api.billing.caps.setCap, { workspaceId, memberId: users.ben, cap: 5_000 })).rejects.toThrow(/Only an admin/);
});

it("lists what members spent with the person first, no page longer than asked for", async () => {
  const { workspaceId, as } = await lab(["ada", "ben", "cy", "dee"]);
  const page = (cursor: string | null) => as("dee").query(api.billing.caps.spending, { workspaceId, month: month(), paginationOpts: { cursor, numItems: 2 } });
  // Dee isn't an admin: she sees herself.
  expect((await page(null)).page.map((row) => row.name)).toEqual(["dee"]);
  const admin = (cursor: string | null) => as("ada").query(api.billing.caps.spending, { workspaceId, month: month(), paginationOpts: { cursor, numItems: 2 } });
  const names: string[] = [];
  for (let cursor: string | null = null, done = false; !done;) {
    const read = await admin(cursor);
    expect(read.page.length).toBeLessThanOrEqual(2);
    names.push(...read.page.map((row) => row.name));
    ({ continueCursor: cursor, isDone: done } = read);
  }
  expect(names).toEqual(["ada", "ben", "cy", "dee"]);
});
