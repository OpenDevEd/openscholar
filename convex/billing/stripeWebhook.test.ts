import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "./billing.test-support";

/** Stripe's answers for one $1.00 top-up of 10,000 credits, refunded `refunded` cents so far. */
function stripeFetch(state: { refunded: number; userId?: string }) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname === "/v1/charges/ch_1") {
      return json({ id: "ch_1", object: "charge", amount: 100, amount_refunded: state.refunded, currency: "usd", payment_intent: "pi_1" });
    }
    if (url.pathname === "/v1/customers/cus_1") {
      return json({ id: "cus_1", object: "customer", metadata: { autumn_id: state.userId } });
    }
    if (url.pathname === "/v1/invoice_payments") {
      return json({ object: "list", data: [{ invoice: "in_1" }], has_more: false });
    }
    if (url.pathname === "/v1/invoices/in_1/lines") {
      return json({ object: "list", data: [{ amount: 100, metadata: { autumn_product_id: "top_up" } }], has_more: false });
    }
    throw new Error(`unexpected Stripe call ${url.pathname}`);
  };
}

describe("refunding a top-up", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    fakeAutumn.reset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("removes the refunded share once, only from what's left, and logs what it removed", async () => {
    const stripe: { refunded: number; userId?: string } = { refunded: 30 };
    vi.stubGlobal("fetch", fakeAutumnFetch(stripeFetch(stripe) as typeof fetch));
    const t = convexTest(schema);
    const userId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("users", {
        clerkId: "clerk_refund",
        email: "refund@test.local",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      await seedCreditsForTest(ctx, { userId: id, paid: 10_000 });
      return id;
    });
    stripe.userId = userId;
    const refund = () =>
      t.action(internal.billing.stripeWebhook.handleEvent, {
        stripeCustomerId: "cus_1",
        refundedChargeId: "ch_1",
      });
    await t.run((ctx) =>
      ctx.db
        .query("billingAccounts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique()
        .then((account) => ctx.db.patch(account!._id, { stripeCustomerId: "cus_1" })),
    );

    // 30 cents of $1 is 3,000 of the 10,000 credits.
    await refund();
    expect(fakeAutumn.balance(userId)).toBe(7_000);

    // The user spends most of the rest, then the whole charge is refunded:
    // 7,000 more are owed but only 1,000 are left.
    fakeAutumn.setBalance(userId, { paid: 1_000 });
    stripe.refunded = 100;
    await refund();
    await refund();
    expect(fakeAutumn.balance(userId)).toBe(0);

    const logged = await t.run((ctx) =>
      ctx.db
        .query("billingUsage")
        .withIndex("by_stripe_charge", (q) => q.eq("stripeChargeId", "ch_1"))
        .collect(),
    );
    expect(logged.map((row) => row.credits)).toEqual([3_000, 1_000]);
  });
});
