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
import { personalWorkspaceOf } from "../workspaces/personal";

const AUTUMN_URL = "https://autumn.test";

/** Credits the fake's signup add-on grants. */
export const FAKE_SIGNUP_CREDITS = 500;

/** Credits each Team seat adds to its organization's pool in the fake (#652). */
export const FAKE_SEAT_CREDITS = 8000;

/** `planId`: the main plan, Free until another is attached, as Autumn auto-enables it on every new customer. */
type Customer = { plan: number; topUp: number; signup: boolean; planId: string };

export const fakeAutumn = {
  customers: new Map<string, Customer>(),
  locks: new Map<string, { customerId: string; credits: number; entityId?: string }>(),
  idempotencyKeys: new Set<string>(),
  /** Each customer's entities (#652): whether each holds a Team seat, its monthly cap, and what it used of it. */
  entities: new Map<string, Map<string, { seated: boolean; cap?: number; used: number }>>(),
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  /** Set when the customer has no saved card: a seat's attach asks for checkout instead of charging. */
  noCard: false,
  /** Makes the next call to this endpoint fail, as if Autumn were down. */
  failNext: null as string | null,

  reset() {
    this.failNext = null;
    this.noCard = false;
    this.customers.clear();
    this.locks.clear();
    this.idempotencyKeys.clear();
    this.entities.clear();
    this.calls = [];
  },

  customer(id: string): Customer {
    let customer = this.customers.get(id);
    if (!customer) {
      customer = { plan: 0, topUp: 0, signup: false, planId: "free" };
      this.customers.set(id, customer);
    }
    return customer;
  },

  entitiesOf(id: string) {
    let entities = this.entities.get(id);
    if (!entities) {
      entities = new Map();
      this.entities.set(id, entities);
    }
    return entities;
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
      { plan_id: customer.planId, status: "active", past_due: false, canceled_at: null, current_period_end: null, add_on: false, auto_enable: customer.planId === "free" },
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

/** The entity a call names on its customer: none when it names none, null when it names one that doesn't exist. */
function entityIn(customerId: string, body: Record<string, unknown>) {
  if (!body.entity_id) return undefined;
  return fakeAutumn.entitiesOf(customerId).get(body.entity_id as string) ?? null;
}

/** The monthly credits cap a call sets on an entity, as its usage limit. */
function capOf(body: Record<string, unknown>) {
  const limit = (body.billing_controls as { usage_limits?: Array<{ feature_id: string; limit: number }> } | undefined)?.usage_limits?.find((entry) => entry.feature_id === "credits");
  return limit ? { cap: limit.limit } : {};
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
      if (body.entity_id) {
        // A Team seat on a member's entity adds its credits to the customer's pool, once.
        const entity = fakeAutumn.entitiesOf(customerId!).get(body.entity_id as string);
        if (!entity) return respond(404, { code: "entity_not_found" });
        if (entity.seated) return respond(400, { code: "plan_already_attached" });
        if (fakeAutumn.noCard) return respond(200, { customer_id: customerId, entity_id: body.entity_id, payment_url: "https://checkout.test" });
        entity.seated = true;
        customer.plan += FAKE_SEAT_CREDITS;
        return respond(200, { customer_id: customerId, entity_id: body.entity_id, payment_url: null });
      }
      if (body.plan_id === "signup_credits") {
        customer.signup = true;
        customer.plan += FAKE_SIGNUP_CREDITS;
      } else if (body.plan_id !== "top_up") {
        // A main plan takes the place of the one before, as plans of one group do in Autumn.
        customer.planId = body.plan_id as string;
      }
      return respond(200, { customer_id: customerId, payment_url: null });
    }
    case "billing.update": {
      const entity = body.entity_id ? fakeAutumn.entitiesOf(customerId!).get(body.entity_id as string) : undefined;
      if (body.cancel_action !== "cancel_immediately" || !entity?.seated) return respond(404, { code: "cus_product_not_found" });
      entity.seated = false;
      const customer = fakeAutumn.customer(customerId!);
      customer.plan = Math.max(0, customer.plan - FAKE_SEAT_CREDITS);
      return respond(200, { success: true });
    }
    case "entities.create": {
      const entities = fakeAutumn.entitiesOf(customerId!);
      if (entities.has(body.entity_id as string)) return respond(409, { code: "entity_already_exists" });
      entities.set(body.entity_id as string, { seated: false, used: 0, ...capOf(body) });
      return respond(200, { id: body.entity_id, subscriptions: [] });
    }
    case "entities.update": {
      const entity = fakeAutumn.entitiesOf(customerId!).get(body.entity_id as string);
      if (!entity) return respond(404, { code: "entity_not_found" });
      entity.cap = capOf(body).cap;
      return respond(200, { id: body.entity_id, subscriptions: [] });
    }
    case "entities.delete":
      return fakeAutumn.entitiesOf(customerId!).delete(body.entity_id as string) ? respond(200, { success: true }) : respond(404, { code: "entity_not_found" });
    case "entities.list":
      return respond(200, {
        list: [...fakeAutumn.entitiesOf(customerId!)].map(([id, { seated }]) => ({ id, subscriptions: seated ? [{ plan_id: "team_seat", status: "active" }] : [] })),
        next_cursor: null,
      });
    case "balances.check": {
      const customer = fakeAutumn.customer(customerId!);
      const credits = body.required_balance as number;
      const lock = body.lock as { lock_id: string } | undefined;
      const entity = entityIn(customerId!, body);
      if (entity === null) return respond(404, { code: "entity_not_found" });
      const allowed = customer.plan + customer.topUp >= credits && (entity?.cap === undefined || entity.used + credits <= entity.cap);
      if (allowed && lock) {
        deduct(customer, credits);
        if (entity) entity.used += credits;
        fakeAutumn.locks.set(lock.lock_id, { customerId: customerId!, credits, ...(body.entity_id ? { entityId: body.entity_id as string } : {}) });
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
      const entity = lock.entityId ? fakeAutumn.entitiesOf(lock.customerId).get(lock.entityId) : undefined;
      if (entity?.cap !== undefined && entity.used - lock.credits + kept > entity.cap) {
        fakeAutumn.locks.set(body.lock_id as string, lock);
        return respond(500, { message: "Redis deduction failed: INSUFFICIENT_BALANCE" });
      }
      if (entity) entity.used += kept - lock.credits;
      if (kept < lock.credits) customer.plan += lock.credits - kept;
      else deduct(customer, kept - lock.credits);
      return respond(200, { success: true });
    }
    case "balances.track": {
      const entity = entityIn(customerId!, body);
      if (entity === null) return respond(404, { code: "entity_not_found" });
      // A capped entity is charged up to what's left of its cap.
      const wanted = entity?.cap === undefined ? (body.value as number) : Math.min(body.value as number, Math.max(0, entity.cap - entity.used));
      const value = deduct(fakeAutumn.customer(customerId!), wanted);
      if (entity) entity.used += value;
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

/** Gives a person's own workspace, or another workspace (#650), credits in the fake and in the cached snapshot. */
export async function seedCreditsForTest(
  ctx: MutationCtx,
  args: ({ userId: Id<"users">; workspaceId?: undefined } | { workspaceId: Id<"workspaces">; userId?: undefined }) & { free?: number; paid?: number; now?: number },
): Promise<void> {
  const free = args.free ?? 0;
  const paid = args.paid ?? 0;
  const workspace = args.workspaceId ? await ctx.db.get("workspaces", args.workspaceId) : null;
  // A workspace's Autumn customer: its person for their own, else the workspace itself.
  const customerId = workspace ? (workspace.kind === "personal" ? workspace.userId : workspace._id) : args.userId!;
  fakeAutumn.setBalance(customerId, { free, paid });
  await ctx.db.insert("billingAccounts", {
    workspaceId: args.workspaceId ?? (await personalWorkspaceOf(ctx, args.userId!)),
    plan: "free",
    pastDue: false,
    balance: free + paid,
    purchased: paid,
    signupGranted: true,
    hasPaid: paid > 0,
    refreshedAt: args.now ?? Date.now(),
  });
}

/** The cached billing account of a person's own workspace. */
export async function accountOf(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const workspaceId = await personalWorkspaceOf(ctx, userId);
  return await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
}
