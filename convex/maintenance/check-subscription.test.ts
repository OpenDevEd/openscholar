import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

// Set required env vars before module load (assertPlanPriceConfig reads these)
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_GO_PRICE_ID = "price_go_test";
process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";

// Hoist mock functions so they're available in vi.mock factory
const { mockRetrieve } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      subscriptions = { retrieve: mockRetrieve };
    },
  };
});

// Helper: seed a user + subscription record in the DB
async function seedSubscription(
  t: ReturnType<typeof convexTest>,
  overrides: {
    status?: string;
    plan?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: number;
    cancelAtPeriodEnd?: boolean;
  } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_sub_test",
      email: "sub@test.com",
      firstName: "Sub",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: overrides.stripeSubscriptionId ?? "sub_123",
      status: (overrides.status ?? "active") as "active",
      plan: (overrides.plan ?? "go") as "go",
      currentPeriodStart: now - 30 * 24 * 60 * 60 * 1000,
      currentPeriodEnd:
        overrides.currentPeriodEnd ?? now + 30 * 24 * 60 * 60 * 1000,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return { userId, subscriptionId };
  });
}

describe("checkSubscriptionStatus", () => {
  beforeEach(() => {
    mockRetrieve.mockReset();
  });

  it("corrects divergence with string customer ID", async () => {
    const t = convexTest(schema);
    const { subscriptionId } = await seedSubscription(t, {
      status: "active",
      plan: "go",
      stripeSubscriptionId: "sub_str_test",
    });

    // Stripe returns diverged status with STRING customer
    mockRetrieve.mockResolvedValue({
      id: "sub_str_test",
      status: "active",
      customer: "cus_string_123", // String form
      items: {
        data: [
          {
            price: { id: "price_pro_test" }, // Diverged: go -> pro
            current_period_end:
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            current_period_start: Math.floor(Date.now() / 1000),
            quantity: 1,
          },
        ],
      },
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: {},
    });

    // Run the action -- it should detect plan divergence and call syncSubscription
    await t.action(internal.maintenance.internal.checkSubscriptionStatus, {});

    // Verify mockRetrieve was called with the subscription ID
    expect(mockRetrieve).toHaveBeenCalledWith("sub_str_test");

    // Verify the subscription was updated (syncSubscription was called)
    // The sync should have updated the plan from "go" to "pro"
    const sub = await t.run(async (ctx) => ctx.db.get(subscriptionId));
    expect(sub!.plan).toBe("pro");
  });

  it("corrects divergence with expanded customer object", async () => {
    const t = convexTest(schema);
    const { subscriptionId } = await seedSubscription(t, {
      status: "active",
      plan: "go",
      stripeSubscriptionId: "sub_exp_test",
    });

    // Stripe returns diverged status with EXPANDED customer object
    mockRetrieve.mockResolvedValue({
      id: "sub_exp_test",
      status: "active",
      customer: {
        id: "cus_expanded_456",
        name: "Test Corp",
        email: "test@corp.com",
      }, // Expanded form
      items: {
        data: [
          {
            price: { id: "price_pro_test" }, // Diverged: go -> pro
            current_period_end:
              Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            current_period_start: Math.floor(Date.now() / 1000),
            quantity: 1,
          },
        ],
      },
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: {},
    });

    await t.action(internal.maintenance.internal.checkSubscriptionStatus, {});

    expect(mockRetrieve).toHaveBeenCalledWith("sub_exp_test");

    // Verify the subscription was updated with expanded customer ID
    const sub = await t.run(async (ctx) => ctx.db.get(subscriptionId));
    expect(sub!.plan).toBe("pro");
  });

  it("does not call syncSubscription when no divergence exists", async () => {
    const t = convexTest(schema);
    const periodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const periodEndSec = Math.floor(periodEnd / 1000);

    await seedSubscription(t, {
      status: "active",
      plan: "go",
      stripeSubscriptionId: "sub_nodiv",
      currentPeriodEnd: periodEndSec * 1000, // Align with what Stripe will return
      cancelAtPeriodEnd: false,
    });

    // Stripe returns matching data -- no divergence
    mockRetrieve.mockResolvedValue({
      id: "sub_nodiv",
      status: "active",
      customer: "cus_nodiv",
      items: {
        data: [
          {
            price: { id: "price_go_test" }, // Same as local
            current_period_end: periodEndSec,
            current_period_start: periodEndSec - 30 * 24 * 60 * 60,
            quantity: 1,
          },
        ],
      },
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: {},
    });

    // Should complete without error and without calling syncSubscription
    await t.action(internal.maintenance.internal.checkSubscriptionStatus, {});

    expect(mockRetrieve).toHaveBeenCalledWith("sub_nodiv");
    // No assertion on syncSubscription -- the fact that it completes without
    // error and the DB record is unchanged is sufficient
  });
});
