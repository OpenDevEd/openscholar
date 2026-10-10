// Team seats follow memberships (#652): one seat for each member of an organization on Team, none otherwise.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { ORGANIZATION_PLAN, SEAT_PLAN, TEAM_PLAN } from "../../lib/billing/plans";
import { FAKE_SEAT_CREDITS, fakeAutumn, installFakeAutumn } from "./billing.test-support";
import { seatChanges } from "./seats";

beforeEach(() => installFakeAutumn());
afterEach(() => vi.unstubAllGlobals());

const entity = (id: string, seated: boolean) => ({ id, subscriptions: seated ? [{ plan_id: SEAT_PLAN, status: "active" }] : [] });

it("seats each member who has no seat, making their entity if needed, and ends every entity that isn't a member", () => {
  const members = ["a", "b", "c"].map((id) => ({ clerkUserId: id, name: id.toUpperCase() }));
  expect(seatChanges(members, [entity("a", true), entity("b", false), entity("x", true), entity("y", false)])).toEqual({
    seat: [{ clerkUserId: "b", name: "B", make: false }, { clerkUserId: "c", name: "C", make: true }],
    end: ["x", "y"],
  });
});

it("gives a Team organization's members a seat each as they join, takes one back as they leave, and ends them all when it leaves Team", async () => {
  const t = convexTest(schema);
  const lab = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    for (const who of ["ada", "ben", "cy"]) await ctx.db.insert("users", { clerkId: `user_${who}`, email: `${who}@lab.test`, firstName: who, state: "active", createdAt: 1, updatedAt: 1 });
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
  });
  let at = 10;
  /** A Clerk membership webhook for `who` in the lab. */
  const membership = (who: string, joined: boolean) =>
    t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: `evt_${who}_${++at}`, eventType: joined ? "organizationMembership.created" : "organizationMembership.deleted", instanceId: "ins_test", occurredAt: at, payloadSha256: `sha_${at}`,
      action: joined ? "upsert" : "delete",
      membership: {
        clerkMembershipId: `mem_${who}`, clerkUserId: `user_${who}`, role: "org:member", state: joined ? "active" : "revoked", clerkCreatedAt: 1, clerkUpdatedAt: at,
        organization: { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1 },
      },
    });
  const seats = () => [...fakeAutumn.entitiesOf(lab)].filter(([, { seated }]) => seated).map(([id]) => id).sort();
  const held = async () => (await t.run((ctx) => ctx.db.query("seatSyncs").withIndex("by_workspace", (q) => q.eq("workspaceId", lab)).unique()))?.seats;
  const writes = () => fakeAutumn.calls.filter((call) => ["entities.create", "entities.delete", "billing.attach", "billing.update"].includes(call.path)).length;

  await membership("ada", true);
  await membership("ben", true);
  fakeAutumn.customer(lab).planId = TEAM_PLAN;
  await t.action(internal.billing.seats.sync, { workspaceId: lab });
  expect(seats()).toEqual(["user_ada", "user_ben"]);
  expect(fakeAutumn.balance(lab)).toBe(2 * FAKE_SEAT_CREDITS);

  // Each membership change syncs by itself.
  await membership("ben", false);
  await membership("cy", true);
  await t.finishAllScheduledFunctions(() => {});
  expect(seats()).toEqual(["user_ada", "user_cy"]);
  expect(fakeAutumn.entitiesOf(lab).has("user_ben")).toBe(false);
  expect(fakeAutumn.balance(lab)).toBe(2 * FAKE_SEAT_CREDITS);

  // Run again, nothing changes.
  const before = writes();
  await t.action(internal.billing.seats.sync, { workspaceId: lab });
  expect(writes()).toBe(before);

  // Without a saved card a new member waits for a seat, and one who leaves still gives theirs up.
  fakeAutumn.noCard = true;
  await membership("cy", false);
  await membership("ben", true);
  await t.finishAllScheduledFunctions(() => {});
  expect(seats()).toEqual(["user_ada"]);
  expect(await held()).toBe(1);
  fakeAutumn.noCard = false;

  // Off Team, every seat ends. One that fails to end keeps the organization in the daily check until it does.
  fakeAutumn.customer(lab).planId = ORGANIZATION_PLAN;
  fakeAutumn.failNext = "billing.update";
  await expect(t.action(internal.billing.seats.sync, { workspaceId: lab })).rejects.toThrow();
  expect(seats()).toEqual(["user_ada"]);
  await t.mutation(internal.billing.seats.syncTeams, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(fakeAutumn.entitiesOf(lab).size).toBe(0);
  expect(fakeAutumn.balance(lab)).toBe(0);
  expect(await held()).toBe(0);
});

it("runs one sync of an organization at a time, and the one asked for meanwhile once after it", async () => {
  const t = convexTest(schema);
  const workspaceId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
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
