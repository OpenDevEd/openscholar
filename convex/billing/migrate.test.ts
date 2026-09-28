import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { importBody } from "./migrate";

const base = {
  userId: "user_1" as Id<"users">,
  email: "a@example.test",
  createdAt: 1,
};

const planIds = (body: ReturnType<typeof importBody>) =>
  body.billables.map((b) => (b.plan as { plan_id: string }).plan_id);

describe("importBody", () => {
  it("keeps a Free user's credits on the signup grant so it's never granted again", () => {
    const body = importBody({ ...base, free: 320, paid: 0 }, 10_000);
    expect(planIds(body)).toEqual(["signup_credits"]);
    expect(body.billables[0]).toMatchObject({
      plan: { balances: [{ feature_id: "credits", balance: 320 }] },
    });
    expect("processors" in body).toBe(false);
  });

  it("links a paying user's subscription with the free pool and keeps top-ups separate", () => {
    const body = importBody({
      ...base,
      stripeCustomerId: "cus_1",
      subscription: { plan: "pro", stripeSubscriptionId: "sub_1", pastDue: true },
      free: 9_000,
      paid: 12_345,
    }, 10_000);
    expect(planIds(body)).toEqual(["signup_credits", "pro", "top_up"]);
    expect(body.processors).toEqual([{ type: "stripe", id: "cus_1" }]);
    expect(body.billables[0]).toMatchObject({ plan: { balances: [{ balance: 0 }] } });
    expect(body.billables[1]).toMatchObject({
      processor: "stripe",
      link: { subscription_id: "sub_1" },
      plan: { status: "past_due", balances: [{ balance: 9_000 }] },
    });
    expect(body.billables[2]).toMatchObject({
      plan: {
        feature_quantities: [{ feature_id: "credits", quantity: 20_000 }],
        balances: [{ balance: 12_345 }],
      },
    });
  });

  it("imports a negative ledger balance as zero", () => {
    const body = importBody({ ...base, free: -40, paid: -5 }, 10_000);
    expect(planIds(body)).toEqual(["signup_credits"]);
    expect(body.billables[0]).toMatchObject({ plan: { balances: [{ balance: 0 }] } });
  });
});
