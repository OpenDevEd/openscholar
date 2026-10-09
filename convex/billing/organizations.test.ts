// An organization's own Autumn customer (#650, slice 7): its workspace's ID, on the free organization plan.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { ORGANIZATION_PLAN } from "../../lib/billing/plans";
import { fakeAutumn, installFakeAutumn } from "./billing.test-support";

beforeEach(() => installFakeAutumn());
afterEach(() => vi.unstubAllGlobals());

it("puts each organization on its own customer and the free organization plan, once however often it runs", async () => {
  const t = convexTest(schema);
  // The harness makes an organization's workspace with it, as the Clerk webhook does.
  const lab = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!._id;
  });
  expect(await t.action(internal.migrations.organizationCustomers.verify, {})).toBe(1);

  expect(await t.action(internal.migrations.organizationCustomers.run, {})).toBe(1);
  await t.finishAllScheduledFunctions(() => {});
  await t.action(internal.billing.accounts.provisionOrganization, { workspaceId: lab });

  expect(fakeAutumn.customer(lab).planId).toBe(ORGANIZATION_PLAN);
  expect(fakeAutumn.calls.filter((call) => call.path === "billing.attach")).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", lab)).unique())).toMatchObject({ plan: ORGANIZATION_PLAN });
  expect(await t.action(internal.migrations.organizationCustomers.verify, {})).toBe(0);
});
