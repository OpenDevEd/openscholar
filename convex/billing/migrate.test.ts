import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { insertMany } from "../lib/maxSize.test-support";
import { importBody, LEDGER_PAGE, readLegacyAccounts, SUBSCRIPTIONS_READ } from "./migrate";

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

describe("readLegacyAccounts", () => {
  async function account() {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "clerk_ledger", email: "ledger@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 });
      return { userId, creditsId: await ctx.db.insert("credits", { userId, createdAt: 1 }) };
    });
    const read = () => readLegacyAccounts({ runQuery: t.query as never }, null);
    return { t, ...ids, read };
  }

  it("adds up a ledger longer than one read (#427)", async () => {
    const { t, creditsId, read } = await account();
    const row = (creditType: "free" | "paid", amount: number) => ({ creditsId, type: "usage", creditType, amount, createdAt: 1 });
    await insertMany(t, "creditTransactions", [
      ...Array.from({ length: LEDGER_PAGE }, () => row("free", 1)),
      ...Array.from({ length: 5 }, () => row("paid", 3)),
    ]);
    expect((await read()).accounts).toMatchObject([{ free: LEDGER_PAGE, paid: 15 }]);
  });

  it("stops by name on a user with more subscription rows than it reads (#427)", async () => {
    const { t, userId, read } = await account();
    await insertMany(t, "subscriptions", Array.from({ length: SUBSCRIPTIONS_READ + 1 }, () => ({ userId, plan: "go", status: "canceled", createdAt: 1, updatedAt: 1 })));
    await expect(read()).rejects.toThrow(/subscription rows/);
  });
});
