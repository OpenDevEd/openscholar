/**
 * Test support for billing. `installFakeAutumn` answers the Autumn HTTP calls
 * OpenScholar makes with an in-memory ledger that follows the behaviour
 * checked against the real server (plans/autumn-billing/README.md):
 * locks hold credits or refuse, finalize settles once, track caps at zero,
 * and an idempotency key charges once.
 *
 * The `.test-support.ts` extension keeps this file out of the Convex bundle.
 */
import { vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const AUTUMN_URL = "https://autumn.test";

/** Credits the fake's signup add-on grants. */
export const FAKE_SIGNUP_CREDITS = 500;

type Customer = { plan: number; topUp: number; signup: boolean };

export const fakeAutumn = {
  customers: new Map<string, Customer>(),
  locks: new Map<string, { customerId: string; credits: number }>(),
  idempotencyKeys: new Set<string>(),
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  /** Makes the next call to this endpoint fail, as if Autumn were down. */
  failNext: null as string | null,

  reset() {
    this.failNext = null;
    this.customers.clear();
    this.locks.clear();
    this.idempotencyKeys.clear();
    this.calls = [];
  },

  customer(id: string): Customer {
    let customer = this.customers.get(id);
    if (!customer) {
      customer = { plan: 0, topUp: 0, signup: false };
      this.customers.set(id, customer);
    }
    return customer;
  },

  balance(id: string): number {
    const customer = this.customer(id);
    return customer.plan + customer.topUp;
  },

  setBalance(id: string, credits: { free?: number; paid?: number }) {
    const customer = this.customer(id);
    customer.plan = credits.free ?? 0;
    customer.topUp = credits.paid ?? 0;
  },
};

/** Takes credits from plan credits first, then top-ups; never below zero. */
function deduct(customer: Customer, credits: number): number {
  const fromPlan = Math.min(customer.plan, credits);
  customer.plan -= fromPlan;
  const fromTopUp = Math.min(customer.topUp, credits - fromPlan);
  customer.topUp -= fromTopUp;
  return fromPlan + fromTopUp;
}

function customerBody(id: string) {
  const customer = fakeAutumn.customer(id);
  return {
    id,
    stripe_id: null,
    subscriptions: [
      { plan_id: "free", status: "active", past_due: false, canceled_at: null, current_period_end: null, add_on: false, auto_enable: true },
      ...(customer.signup
        ? [{ plan_id: "signup_credits", status: "active", past_due: false, canceled_at: null, current_period_end: null, add_on: true, auto_enable: false }]
        : []),
    ],
    balances: {
      credits: {
        remaining: customer.plan + customer.topUp,
        breakdown: [
          { id: `plan-${id}`, plan_id: "free", remaining: customer.plan },
          { id: `topup-${id}`, plan_id: "top_up", remaining: customer.topUp },
        ],
      },
    },
  };
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function handle(path: string, body: Record<string, unknown>, idempotencyKey: string | null) {
  fakeAutumn.calls.push({ path, body });
  if (fakeAutumn.failNext === path) {
    fakeAutumn.failNext = null;
    return respond(503, { message: "Autumn is down" });
  }
  if (idempotencyKey) {
    if (fakeAutumn.idempotencyKeys.has(idempotencyKey)) {
      return respond(409, { code: "duplicate_idempotency_key" });
    }
    fakeAutumn.idempotencyKeys.add(idempotencyKey);
  }
  const customerId = body.customer_id as string | undefined;
  switch (path) {
    case "customers.get_or_create":
      return respond(200, customerBody(customerId!));
    case "billing.attach": {
      const customer = fakeAutumn.customer(customerId!);
      if (body.plan_id === "signup_credits") {
        customer.signup = true;
        customer.plan += FAKE_SIGNUP_CREDITS;
      }
      return respond(200, { customer_id: customerId, payment_url: null });
    }
    case "balances.check": {
      const customer = fakeAutumn.customer(customerId!);
      const credits = body.required_balance as number;
      const lock = body.lock as { lock_id: string } | undefined;
      const allowed = customer.plan + customer.topUp >= credits;
      if (allowed && lock) {
        deduct(customer, credits);
        fakeAutumn.locks.set(lock.lock_id, { customerId: customerId!, credits });
      }
      return respond(200, { allowed, balance: customerBody(customerId!).balances.credits });
    }
    case "balances.finalize": {
      const lock = fakeAutumn.locks.get(body.lock_id as string);
      if (!lock) return respond(400, { message: `Lock not found for ID: ${body.lock_id}` });
      fakeAutumn.locks.delete(body.lock_id as string);
      const customer = fakeAutumn.customer(lock.customerId);
      const kept = body.action === "confirm" ? ((body.override_value as number | undefined) ?? lock.credits) : 0;
      if (kept > lock.credits + customer.plan + customer.topUp) {
        fakeAutumn.locks.set(body.lock_id as string, lock);
        return respond(500, { message: "Redis deduction failed: INSUFFICIENT_BALANCE" });
      }
      if (kept < lock.credits) customer.plan += lock.credits - kept;
      else deduct(customer, kept - lock.credits);
      return respond(200, { success: true });
    }
    case "balances.track": {
      const value = deduct(fakeAutumn.customer(customerId!), body.value as number);
      return respond(200, {
        balance: customerBody(customerId!).balances.credits,
        deductions: value > 0 ? [{ value }] : [],
      });
    }
    case "balances.update": {
      const customer = fakeAutumn.customer(customerId!);
      const key = body.balance_id === `topup-${customerId}` ? "topUp" : "plan";
      customer[key] = Math.max(0, customer[key] + (body.add_to_balance as number));
      return respond(200, { success: true });
    }
    default:
      return respond(404, { message: `fake Autumn has no ${path}` });
  }
}

/**
 * A fetch that answers Autumn calls from the fake and hands every other
 * request to `fallback`. For tests that already mock fetch.
 */
export function fakeAutumnFetch(
  fallback: typeof fetch = () => Promise.reject(new Error("unexpected fetch")),
) {
  process.env.AUTUMN_URL = AUTUMN_URL;
  process.env.AUTUMN_SECRET_KEY = "am_sk_test_fake";
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${AUTUMN_URL}/v1/`)) return fallback(input, init);
    return handle(
      url.slice(`${AUTUMN_URL}/v1/`.length),
      JSON.parse(String(init?.body ?? "{}")),
      new Headers(init?.headers).get("Idempotency-Key"),
    );
  };
}

/** Routes Autumn calls to a fresh in-memory fake; other requests go through. */
export function installFakeAutumn() {
  fakeAutumn.reset();
  vi.stubGlobal("fetch", fakeAutumnFetch(globalThis.fetch));
}

/** Gives a user credits in the fake and in the cached snapshot. */
export async function seedCreditsForTest(
  ctx: MutationCtx,
  args: { userId: Id<"users">; free?: number; paid?: number; now?: number },
): Promise<void> {
  const free = args.free ?? 0;
  const paid = args.paid ?? 0;
  fakeAutumn.setBalance(args.userId, { free, paid });
  await ctx.db.insert("billingAccounts", {
    userId: args.userId,
    plan: "free",
    pastDue: false,
    balance: free + paid,
    purchased: paid,
    signupGranted: true,
    hasPaid: paid > 0,
    refreshedAt: args.now ?? Date.now(),
  });
}
