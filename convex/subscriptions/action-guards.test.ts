import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

/**
 * Every public subscription/billing action must enforce the
 * `subscriptions.enabled` master switch. If the flag is off globally, the
 * action must throw FEATURE_DISABLED before touching Stripe or user data.
 */

async function seedMasterFlag(enabled: boolean) {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", {
      key: "subscriptions.enabled",
      enabled,
      minimumTier: 0,
      description: "(test) subscriptions master switch",
      updatedAt: Date.now(),
    });
  });
  return t;
}

describe("subscription actions enforce subscriptions.enabled", () => {
  test("getPlans throws FEATURE_DISABLED when master switch is off", async () => {
    const t = await seedMasterFlag(false);
    await expect(
      t.action(api.subscriptions.actions.getPlans, {}),
    ).rejects.toThrow(/FEATURE_DISABLED/);
  });

  test("createPortalSession throws FEATURE_DISABLED when master switch is off", async () => {
    const t = await seedMasterFlag(false);
    await expect(
      t.action(api.subscriptions.actions.createPortalSession, {}),
    ).rejects.toThrow(/FEATURE_DISABLED/);
  });

  test("getSubscriptionDetails throws FEATURE_DISABLED when master switch is off", async () => {
    const t = await seedMasterFlag(false);
    await expect(
      t.action(api.subscriptions.actions.getSubscriptionDetails, {}),
    ).rejects.toThrow(/FEATURE_DISABLED/);
  });
});
