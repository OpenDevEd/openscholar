// A person's plan change (#860): an upgrade from one paid plan to another starts a new month, so a prorated price
// never buys a full month of credits; a first plan and a downgrade are left to Autumn, which refuses a new month on a downgrade.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { personalWorkspaceOf } from "../workspaces/personal";
import schema from "../schema";
import { fakeAutumn, installFakeAutumn } from "./billing.test-support";

beforeEach(() => {
  installFakeAutumn();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const plan = (id: string, amount?: number) => ({ id, name: id, addOn: false, autoEnable: !amount, features: [], popular: false, ...(amount ? { price: { amount, interval: "month" } } : {}) });

it("starts a new month only on an upgrade from a paid plan, archived or not, and says when the new plan renews", async () => {
  const t = convexTest(schema);
  const { catalogId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "user_ada", email: "ada@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    return { catalogId: await ctx.db.insert("billingCatalog", { plans: [plan("free"), plan("go", 5), plan("pro", 20)], features: [], syncedAt: 1 }), userId };
  });
  fakeAutumn.prices.set("go", { amount: 5, interval: "month" }).set("pro", { amount: 20, interval: "month" });
  const ada = t.withIdentity({ subject: "user_ada" });
  const newMonth = (path: string) => fakeAutumn.calls.filter((call) => call.path === path).map((call) => call.body.billing_cycle_anchor ?? "same month");

  // Free to Go: the first paid plan starts its month anyway.
  await ada.action(api.billing.actions.previewPlan, { plan: "go" });
  await ada.action(api.billing.actions.choosePlan, { plan: "go" });
  // Go to Pro: a new month at Pro's price, less Go's unused days.
  const preview = await ada.action(api.billing.actions.previewPlan, { plan: "pro" });
  await ada.action(api.billing.actions.choosePlan, { plan: "pro" });
  // Pro to Go waits for the renewal.
  await ada.action(api.billing.actions.choosePlan, { plan: "go" });
  // A declined card changes nothing and says why (#40); it isn't sent anywhere to pay.
  fakeAutumn.declineCard = true;
  await expect(ada.action(api.billing.actions.choosePlan, { plan: "pro" })).rejects.toThrow(/declined/);
  fakeAutumn.declineCard = false;
  expect(fakeAutumn.customer(userId).planId).toBe("go");
  // Go taken off the catalog still costs its subscribers $5: Go to Pro is still an upgrade.
  await t.run((ctx) => ctx.db.patch(catalogId, { plans: [plan("free"), plan("pro", 20)] }));
  await ada.action(api.billing.actions.previewPlan, { plan: "pro" });
  await ada.action(api.billing.actions.choosePlan, { plan: "pro" });

  expect(newMonth("billing.preview_attach")).toEqual(["same month", "now", "now"]);
  expect(newMonth("billing.attach")).toEqual(["same month", "now", "same month", "now", "now"]);
  expect(preview.renewsAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
});

it("keeps the payment that failed on a past-due account, to pay before the plan ends, and drops it once paid", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "user_ada", email: "ada@test.local", state: "active", createdAt: 1, updatedAt: 1 }));
  const customer = fakeAutumn.customer(userId);
  Object.assign(customer, { planId: "pro", pastDue: true, invoices: [
    { status: "paid", total: 20, currency: "usd", created_at: 1_000 },
    { status: "open", total: 20, currency: "usd", created_at: 3_000, hosted_invoice_url: "https://pay.test/in_2" },
    { status: "void", total: 15, currency: "usd", created_at: 2_000 },
  ] });
  const ada = t.withIdentity({ subject: "user_ada" });
  const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, userId));
  await t.action(internal.billing.accounts.refresh, { workspaceId });
  expect((await ada.query(api.billing.accounts.mine, {}))?.unpaid).toEqual({ amount: 20, currency: "usd", since: 3_000, url: "https://pay.test/in_2" });
  Object.assign(customer, { pastDue: false, invoices: [] });
  await t.action(internal.billing.accounts.refresh, { workspaceId });
  expect((await ada.query(api.billing.accounts.mine, {}))?.unpaid).toBeUndefined();
});
