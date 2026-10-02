/**
 * One-time move of existing billing data into Autumn (plans/autumn-billing).
 *
 *   npx convex run billing/migrate:run '{"dryRun": true}'    report only
 *   npx convex run billing/migrate:run '{"dryRun": false}'   import
 *   npx convex run billing/migrate:verify '{}'               compare balances
 *
 * Balances come from the creditTransactions ledger, which the old balance
 * counters were derived from. Each user becomes one `billing.import`: the
 * live Go/Pro subscription linked by its Stripe id and holding the free
 * pool, the signup credits (the free pool for Free users) so they're never
 * granted again, and the paid pool as a top-up that never expires.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { refreshAccount } from "./accounts";
import { SIGNUP_PLAN, TOPUP_PLAN } from "../../lib/billing/plans";
import { findPlan } from "../../lib/billing/catalog";

const BATCH = 25;
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const legacyAccountValidator = v.object({
  userId: v.id("users"),
  email: v.string(),
  name: v.optional(v.string()),
  createdAt: v.number(),
  stripeCustomerId: v.optional(v.string()),
  subscription: v.optional(
    v.object({
      plan: v.union(v.literal("go"), v.literal("pro")),
      stripeSubscriptionId: v.string(),
      pastDue: v.boolean(),
    }),
  ),
  free: v.number(),
  paid: v.number(),
});

export const legacyAccounts = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    accounts: v.array(legacyAccountValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("users").paginate({ cursor, numItems: BATCH });
    const accounts = [];
    for (const user of page.page) {
      if (user.state === "deleted") continue;
      const [credits, subscriptions, customer] = await Promise.all([
        ctx.db
          .query("credits")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique(),
        ctx.db
          .query("subscriptions")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect(),
        ctx.db
          .query("billingCustomers")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first(),
      ]);
      let free = 0;
      let paid = 0;
      if (credits) {
        for await (const tx of ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))) {
          if (tx.creditType === "free") free += tx.amount;
          else paid += tx.amount;
        }
      }
      const live = subscriptions
        .filter(
          (s) =>
            (s.plan === "go" || s.plan === "pro") &&
            s.stripeSubscriptionId &&
            LIVE_STATUSES.has(s.status),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
      accounts.push({
        userId: user._id,
        email: user.email,
        name,
        createdAt: user.createdAt,
        stripeCustomerId:
          customer?.stripeCustomerId ??
          subscriptions.find((s) => s.stripeCustomerId)?.stripeCustomerId,
        subscription:
          live && (live.plan === "go" || live.plan === "pro")
            ? {
                plan: live.plan,
                stripeSubscriptionId: live.stripeSubscriptionId!,
                pastDue: live.status === "past_due",
              }
            : undefined,
        free,
        paid,
      });
    }
    return { accounts, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

type LegacyAccount = (typeof legacyAccountValidator)["type"];

/**
 * The `billing.import` body for one user. Negative ledger balances import as
 * 0. `topUpUnit` is the credits in one top-up billing unit.
 */
export function importBody(account: LegacyAccount, topUpUnit: number) {
  const free = Math.max(0, account.free);
  const paid = Math.max(0, account.paid);
  const stripe = account.stripeCustomerId ? ("stripe" as const) : undefined;
  const credits = (balance: number) => [{ feature_id: "credits", balance }];
  const billables: Array<Record<string, unknown>> = [
    {
      plan: {
        plan_id: SIGNUP_PLAN,
        balances: credits(account.subscription ? 0 : free),
      },
    },
  ];
  if (account.subscription) {
    billables.push({
      processor: "stripe",
      link: { subscription_id: account.subscription.stripeSubscriptionId },
      plan: {
        plan_id: account.subscription.plan,
        status: account.subscription.pastDue ? "past_due" : "active",
        balances: credits(free),
      },
    });
  }
  if (paid > 0) {
    billables.push({
      ...(stripe ? { processor: stripe } : {}),
      plan: {
        plan_id: TOPUP_PLAN,
        feature_quantities: [
          {
            feature_id: "credits",
            quantity: Math.ceil(paid / topUpUnit) * topUpUnit,
          },
        ],
        balances: credits(paid),
      },
    });
  }
  return {
    customer_id: account.userId,
    customer_data: {
      email: account.email,
      ...(account.name ? { name: account.name } : {}),
      created_at: account.createdAt,
    },
    ...(account.stripeCustomerId
      ? { processors: [{ type: "stripe", id: account.stripeCustomerId }] }
      : {}),
    billables,
  };
}

async function callImport(body: Record<string, unknown>) {
  const response = await fetch(`${process.env.AUTUMN_URL}/v1/billing.import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AUTUMN_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

async function importAccount(
  ctx: ActionCtx,
  account: LegacyAccount,
  topUpUnit: number,
  dryRun: boolean,
) {
  const result = await callImport({ ...importBody(account, topUpUnit), dry_run: dryRun });
  if (result.status !== 200) {
    console.error(`[migrate] ${account.userId} failed (${result.status}): ${result.body}`);
    return false;
  }
  // Autumn answers 200 even when a plan may be imaged wrong, such as a
  // subscription it can't find a billing anchor for.
  const { flashed } = JSON.parse(result.body) as {
    flashed: Array<{ plan_id: string; mismatch?: boolean; reason?: string }>;
  };
  const mismatches = flashed.filter((plan) => plan.mismatch);
  if (mismatches.length > 0) {
    console.error(
      `[migrate] ${account.userId} mismatch: ${mismatches.map((plan) => `${plan.plan_id}: ${plan.reason}`).join("; ")}`,
    );
    return false;
  }
  if (!dryRun) await refreshAccount(ctx, account.userId, { card: true });
  console.log(
    `[migrate] ${dryRun ? "checked" : "imported"} ${account.userId}: ${account.subscription?.plan ?? "free"}, free ${account.free}, paid ${account.paid}`,
  );
  return true;
}

export const run = internalAction({
  args: {
    dryRun: v.boolean(),
    cursor: v.optional(v.union(v.string(), v.null())),
    imported: v.optional(v.number()),
    failed: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const catalog = await ctx.runQuery(api.billing.catalog.get, {});
    const topUpUnit = catalog && findPlan(catalog, TOPUP_PLAN)?.credits?.unitPrice?.billingUnits;
    if (!topUpUnit) throw new Error("The catalog has no top-up plan with a billing unit; sync it first");
    const page = await ctx.runQuery(internal.billing.migrate.legacyAccounts, {
      cursor: args.cursor ?? null,
    });
    let imported = args.imported ?? 0;
    let failed = args.failed ?? 0;
    for (const account of page.accounts) {
      if (await importAccount(ctx, account, topUpUnit, args.dryRun)) imported += 1;
      else failed += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billing.migrate.run, {
        dryRun: args.dryRun,
        cursor: page.continueCursor,
        imported,
        failed,
      });
      return null;
    }
    console.log(`[migrate] done: ${imported} ${args.dryRun ? "checked" : "imported"}, ${failed} failed`);
    return null;
  },
});

/** Lists every user whose Autumn plan or balance differs from the old data. */
export const verify = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())), mismatches: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(internal.billing.migrate.legacyAccounts, {
      cursor: args.cursor ?? null,
    });
    let mismatches = args.mismatches ?? 0;
    for (const account of page.accounts) {
      const expected = {
        plan: account.subscription?.plan ?? "free",
        balance: Math.max(0, account.free) + Math.max(0, account.paid),
      };
      const actual = await refreshAccount(ctx, account.userId as Id<"users">);
      if (actual.plan !== expected.plan || actual.balance !== expected.balance) {
        mismatches += 1;
        console.error(
          `[migrate] ${account.userId}: Autumn ${actual.plan} ${actual.balance}, old data ${expected.plan} ${expected.balance}`,
        );
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billing.migrate.verify, {
        cursor: page.continueCursor,
        mismatches,
      });
      return null;
    }
    console.log(`[migrate] verify done: ${mismatches} mismatches`);
    return null;
  },
});
