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

/** The fake's billing period: it started a day ago and renews in a month. */
const DAY = 86_400_000;

/**
 * `planId`: the main plan, Free until another is attached, as Autumn auto-enables it on every new customer. `flags`: the boolean features its plan grants.
 * `seats`: Team seats bought (#862). `next`: the plan it moves to at the renewal. `periodStart`: when its billing period began.
 */
type Customer = { plan: number; topUp: number; signup: boolean; planId: string; flags?: readonly string[]; seats: number; next?: string; periodStart: number; pastDue?: boolean; invoices?: Array<{ plan_ids?: string[]; stripe_id?: string; status: string; total: number; currency: string; created_at: number; hosted_invoice_url?: string }> };

export const fakeAutumn = {
  customers: new Map<string, Customer>(),
  locks: new Map<string, { customerId: string; credits: number; entityId?: string }>(),
  idempotencyKeys: new Set<string>(),
  /** Each customer's entities (#652): whether each holds a Team seat (a license, #863), its monthly cap, and what it used of it. */
  entities: new Map<string, Map<string, { seated: boolean; cap?: number; used: number }>>(),
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  /** Each priced plan's price, as a subscription's expanded plan gives it; a plan not here is free. */
  prices: new Map<string, { amount: number; interval: string }>(),
  /** Set when the customer has no saved card: buying Team asks for checkout instead of charging, and the customer shows no card. */
  noCard: false,
  /** Set when the saved card asks to confirm each payment (3-D Secure): a charge sends a page to pay on. */
  confirmPayments: false,
  /** Set when the saved card is declined: a charge changes nothing and says so. */
  declineCard: false,
  /** Makes the next call to this endpoint fail, as if Autumn were down. */
  failNext: null as string | null,
  /** The member limits set on organizations in Clerk (#652), in order, and how many more Clerk refuses first. */
  memberLimits: [] as Array<{ organization: string; limit: number }>,
  refuseLimits: 0,
  /** What Clerk counts in an organization when asked, ahead of the projections; none when not set. */
  clerkCounts: new Map<string, { members: number; invitations: number }>(),

  reset() {
    this.failNext = null;
    this.memberLimits = [];
    this.refuseLimits = 0;
    this.clerkCounts.clear();
    this.noCard = false;
    this.confirmPayments = false;
    this.declineCard = false;
    this.customers.clear();
    this.locks.clear();
    this.idempotencyKeys.clear();
    this.entities.clear();
    this.prices.clear();
    this.calls = [];
  },

  customer(id: string): Customer {
    let customer = this.customers.get(id);
    if (!customer) {
      customer = { plan: 0, topUp: 0, signup: false, planId: "free", seats: 0, periodStart: Date.now() - DAY };
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

  /** Puts a customer on Team with `seats` seats bought, as a paid move does. */
  team(id: string, seats: number) {
    const customer = this.customer(id);
    customer.planId = TEAM;
    customer.seats = seats;
    customer.plan = seats * FAKE_SEAT_CREDITS;
  },

  /** The entities holding a seat, sorted. */
  seated(id: string) {
    return [...this.entitiesOf(id)].filter(([, entity]) => entity.seated).map(([entityId]) => entityId).sort();
  },
};

const TEAM = "team";
const SEAT = "team_seat";
const ORGANIZATION = "free_organization";

/** What a charge answers when the card can't be charged as it is: a page to pay on, and why when it was declined. */
function unpaid(customerId: string) {
  if (fakeAutumn.declineCard) return { customer_id: customerId, payment_url: "https://pay.test", required_action: { code: "payment_failed", reason: "Your card was declined." } };
  if (fakeAutumn.noCard || fakeAutumn.confirmPayments) return { customer_id: customerId, payment_url: "https://checkout.test" };
  return null;
}

/** The seat count a call sets, from its license quantities. */
const seatsIn = (body: Record<string, unknown>) => (body.license_quantities as Array<{ license_plan_id: string; quantity: number }> | undefined)?.find((entry) => entry.license_plan_id === SEAT)?.quantity;

/** A preview of `seats` Team seats against `from`: the seats' days left to the renewal, as one line. */
function seatPreview(customerId: string, from: number, seats: number) {
  const customer = fakeAutumn.customer(customerId);
  const end = customer.periodStart + 30 * DAY;
  const total = (seats - from) * 24;
  return { customer_id: customerId, total, currency: "usd", redirect_to_checkout: false, line_items: [{ description: `${seats}x Team seat`, total, plan_id: SEAT, period: { start: Date.now(), end } }] };
}

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
    flags: Object.fromEntries((customer.flags ?? []).map((feature) => [feature, {}])),
    subscriptions: [
      {
        plan_id: customer.planId, status: "active", past_due: customer.pastDue ?? false, canceled_at: customer.next ? Date.now() : null, add_on: false, auto_enable: customer.planId === "free", plan: { id: customer.planId, price: fakeAutumn.prices.get(customer.planId) ?? null },
        current_period_start: customer.planId === TEAM ? customer.periodStart : null, current_period_end: customer.planId === TEAM ? customer.periodStart + 30 * DAY : null,
      },
      ...(customer.next ? [{ plan_id: customer.next, status: "scheduled", past_due: false, canceled_at: null, current_period_end: null, add_on: false, auto_enable: false }] : []),
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
      // The saved card, when the call asks for it and the customer has one.
      return respond(200, {
        ...customerBody(customerId!),
        ...((body.expand as string[] | undefined)?.includes("payment_method") && !fakeAutumn.noCard ? { payment_method: { card: { brand: "visa", last4: "4242" } } } : {}),
        ...((body.expand as string[] | undefined)?.includes("invoices") ? { invoices: fakeAutumn.customer(customerId!).invoices ?? [] } : {}),
      });
    case "billing.attach": {
      const customer = fakeAutumn.customer(customerId!);
      if (body.plan_id === TEAM) {
        if (customer.planId === TEAM) return respond(409, { code: "plan_already_attached" });
        const unpaidNow = unpaid(customerId!);
        if (unpaidNow) return respond(200, unpaidNow);
        fakeAutumn.team(customerId!, seatsIn(body) ?? 0);
        return respond(200, { customer_id: customerId, payment_url: null });
      }
      // Leaving Team for the free organization plan waits for the renewal, as a move down does.
      if (body.plan_id === ORGANIZATION && customer.planId === TEAM) {
        customer.next = ORGANIZATION;
        return respond(200, { customer_id: customerId, payment_url: null });
      }
      if (body.plan_id !== "signup_credits" && body.plan_id !== ORGANIZATION) {
        const unpaidNow = fakeAutumn.declineCard ? unpaid(customerId!) : null;
        if (unpaidNow) return respond(200, unpaidNow);
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
    case "billing.preview_attach":
      if (body.plan_id === TEAM) return respond(200, seatPreview(customerId!, 0, seatsIn(body) ?? 0));
      // The new plan's line pays a month from now, as an immediate change's does.
      return respond(200, { customer_id: customerId, total: 0, currency: "usd", redirect_to_checkout: false, line_items: [{ description: `${body.plan_id}`, total: 0, plan_id: body.plan_id, period: { start: Date.now(), end: Date.now() + 30 * 86_400_000 } }] });
    case "billing.update": {
      const customer = fakeAutumn.customer(customerId!);
      if (body.plan_id !== customer.planId) return respond(404, { code: "cus_product_not_found" });
      if (body.cancel_action === "uncancel") {
        customer.next = undefined;
        return respond(200, { customer_id: customerId, payment_url: null });
      }
      // Cancelled at once, Team's seats end and Autumn gives the customer its default plan back.
      if (body.cancel_action === "cancel_immediately") {
        customer.planId = "free";
        customer.next = undefined;
        customer.seats = 0;
        customer.plan = 0;
        for (const entity of fakeAutumn.entitiesOf(customerId!).values()) entity.seated = false;
        return respond(200, { customer_id: customerId, payment_url: null });
      }
      const seats = seatsIn(body);
      if (seats === undefined) return respond(400, { message: "Nothing to change." });
      if (seats < fakeAutumn.seated(customerId!).length) return respond(400, { code: "invalid_request", message: "Release licenses first." });
      if (seats > customer.seats) {
        const unpaidNow = unpaid(customerId!);
        if (unpaidNow) return respond(200, unpaidNow);
      }
      customer.plan = Math.max(0, customer.plan + (seats - customer.seats) * FAKE_SEAT_CREDITS);
      customer.seats = seats;
      return respond(200, { customer_id: customerId, payment_url: null });
    }
    case "billing.preview_update":
      return respond(200, seatPreview(customerId!, fakeAutumn.customer(customerId!).seats, seatsIn(body) ?? 0));
    case "licenses.attach": {
      const customer = fakeAutumn.customer(customerId!);
      const entities = fakeAutumn.entitiesOf(customerId!);
      const fresh = (body.entities as Array<{ entity_id: string }>).filter(({ entity_id }) => !entities.get(entity_id)?.seated);
      if (customer.planId !== TEAM) return respond(400, { message: "No plan on this customer offers this license." });
      if (fresh.length > customer.seats - fakeAutumn.seated(customerId!).length) return respond(400, { code: "invalid_request", message: "No available licenses for this plan." });
      for (const { entity_id } of fresh) entities.set(entity_id, { used: 0, ...entities.get(entity_id), seated: true });
      return respond(200, { success: true });
    }
    case "licenses.release": {
      for (const id of body.entity_ids as string[]) {
        const entity = fakeAutumn.entitiesOf(customerId!).get(id);
        if (entity) entity.seated = false;
      }
      return respond(200, { success: true });
    }
    case "licenses.list": {
      const customer = fakeAutumn.customer(customerId!);
      const usage = fakeAutumn.seated(customerId!).length;
      return respond(200, { list: customer.planId === TEAM ? [{ license_plan_id: SEAT, granted: customer.seats, usage, remaining: customer.seats - usage }] : [] });
    }
    case "licenses.list_assignments":
      return respond(200, { list: fakeAutumn.seated(customerId!).map((id) => ({ entity_id: id, license_plan_id: SEAT })) });
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
        list: [...fakeAutumn.entitiesOf(customerId!)].map(([id, { seated }]) => ({ id, subscriptions: seated ? [{ plan_id: SEAT, status: "active" }] : [] })),
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
    // Clerk counting an organization's members, or its pending invitations.
    const counted = url.match(/^https:\/\/api\.clerk\.com\/v1\/organizations\/([^/?]+)(\/invitations)?\?/);
    if (counted && (init?.method ?? "GET") === "GET") {
      const clerk = fakeAutumn.clerkCounts.get(counted[1]!) ?? { members: 0, invitations: 0 };
      return respond(200, counted[2] ? { data: [], total_count: clerk.invitations } : { id: counted[1], members_count: clerk.members });
    }
    // A seat sync setting an organization's member limit in Clerk.
    const organization = url.match(/^https:\/\/api\.clerk\.com\/v1\/organizations\/([^/]+)$/)?.[1];
    const limit = init?.method === "PATCH" && organization ? (JSON.parse(String(init.body ?? "{}")) as { max_allowed_memberships?: number }).max_allowed_memberships : undefined;
    if (organization && limit !== undefined) {
      if (fakeAutumn.refuseLimits > 0 && fakeAutumn.refuseLimits--) return respond(500, { errors: [{ code: "internal_clerk_error" }] });
      fakeAutumn.memberLimits.push({ organization, limit });
      return respond(200, { id: organization, max_allowed_memberships: limit });
    }
    if (!url.startsWith(`${AUTUMN_URL}/v1/`)) return fallback(input, init);
    return handle(
      url.slice(`${AUTUMN_URL}/v1/`.length),
      JSON.parse(String(init?.body ?? "{}")),
      new Headers(init?.headers).get("Idempotency-Key"),
    );
  };
}

/** Routes Autumn calls, and Clerk's member limits, to a fresh in-memory fake; other requests go through. */
/** Puts the Team plan and its seats on sale, for a test of them: `subscriptions.team` is off for the public alpha. */
export const sellTeamForTest = (ctx: Pick<MutationCtx, "db">) => ctx.db.insert("featureFlags", { key: "subscriptions.team", enabled: true, description: "", updatedAt: 1 });

export function installFakeAutumn() {
  fakeAutumn.reset();
  vi.stubGlobal("fetch", fakeAutumnFetch(globalThis.fetch));
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
}

/** Gives a person's own workspace, or another workspace (#650), credits in the fake and in the cached snapshot, on a plan that grants `features`. */
export async function seedCreditsForTest(
  ctx: MutationCtx,
  args: ({ userId: Id<"users">; workspaceId?: undefined } | { workspaceId: Id<"workspaces">; userId?: undefined }) & { free?: number; paid?: number; now?: number; features?: readonly string[] },
): Promise<void> {
  const free = args.free ?? 0;
  const paid = args.paid ?? 0;
  const workspace = args.workspaceId ? await ctx.db.get("workspaces", args.workspaceId) : null;
  // A workspace's Autumn customer: its person for their own, else the workspace itself.
  const customerId = workspace ? (workspace.kind === "personal" ? workspace.userId : workspace._id) : args.userId!;
  fakeAutumn.setBalance(customerId, { free, paid });
  if (args.features) fakeAutumn.customer(customerId).flags = args.features;
  await ctx.db.insert("billingAccounts", {
    workspaceId: args.workspaceId ?? (await personalWorkspaceOf(ctx, args.userId!)),
    plan: "free",
    pastDue: false,
    balance: free + paid,
    purchased: paid,
    signupGranted: true,
    hasPaid: paid > 0,
    refreshedAt: args.now ?? Date.now(),
    ...(args.features ? { features: [...args.features] } : {}),
  });
}

/**
 * Puts an organization on a plan that grants `features` (#652): its workspace, made if it has
 * none yet, and the cached account that says what its plan includes.
 */
export async function grantPlanFeaturesForTest(ctx: MutationCtx, organizationId: Id<"organizations">, features: readonly string[]) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  const workspaceId = workspace?._id ?? (await ctx.db.insert("workspaces", { kind: "organization", organizationId }));
  const account = await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
  if (account) await ctx.db.patch("billingAccounts", account._id, { features: [...new Set([...(account.features ?? []), ...features])] });
  else await ctx.db.insert("billingAccounts", { workspaceId, plan: "team", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: Date.now(), features: [...features] });
  return workspaceId;
}

/** The cached billing account of a person's own workspace. */
export async function accountOf(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const workspaceId = await personalWorkspaceOf(ctx, userId);
  return await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
}
