/**
 * HTTP client for the self-hosted Autumn billing server. Only actions call it.
 * Every failed call logs the endpoint, status, and Autumn's response body.
 */

import { createError } from "../lib/errors";

export type AutumnBalance = {
  next_reset_at?: number | null;
  remaining: number;
  /** What the customer's plans grant of the feature. */
  granted?: number;
  unlimited?: boolean;
  breakdown?: Array<{
    id: string;
    /** The plan that gave or sold it; none for one given by hand. */
    plan_id: string | null;
    remaining: number;
    /** What the grant gives, which a refill restores. */
    included_grant?: number;
    /** What was bought of it, beside what it gives. */
    prepaid_grant?: number;
    reset?: { interval: string; resets_at: number | null } | null;
  }>;
};

export type AutumnSubscription = {
  plan_id: string;
  /** Set on the plan Autumn gives every customer automatically. */
  auto_enable: boolean;
  status: "active" | "scheduled" | "trialing" | "expired" | string;
  past_due: boolean;
  canceled_at: number | null;
  current_period_start?: number | null;
  current_period_end: number | null;
  add_on: boolean;
  /** The plan as subscribed, archived or not: only when the customer is read with `plans`. */
  plan?: Pick<AutumnPlan, "id" | "price">;
};

export type AutumnCustomer = {
  id: string;
  /** None on an organisation's customer until someone gives it one. */
  email?: string | null;
  stripe_id: string | null;
  subscriptions: AutumnSubscription[];
  purchases?: Array<{ plan_id: string }>;
  balances: Partial<Record<string, AutumnBalance>>;
  /** Boolean features the customer has, keyed by feature id. */
  flags?: Record<string, unknown>;
  /** Its invoices, newest first, only when the customer is read with `invoices`: `hosted_invoice_url` is where one is paid. */
  invoices?: Array<{ plan_ids?: string[]; stripe_id?: string; status: string; total: number; currency: string; created_at: number; hosted_invoice_url?: string | null }>;
  payment_method?: { card?: { brand: string; last4: string } | null } | null;
};

/** A member's entity on an organization's customer (#652), with the plans it holds. */
export type AutumnEntity = {
  id: string;
  subscriptions: Array<Pick<AutumnSubscription, "plan_id" | "status">>;
};

export type AutumnPlanItem = {
  feature_id: string;
  included: number;
  unlimited: boolean;
  reset: { interval: string } | null;
  price: { amount: number; interval: string; billing_units: number } | null;
  rollover?: { max: number | null } | null;
};

export type AutumnPlan = {
  id: string;
  name: string;
  description: string | null;
  group: string | null;
  add_on: boolean;
  auto_enable: boolean;
  archived: boolean;
  price: { amount: number; interval: string } | null;
  items: AutumnPlanItem[];
  metadata: Record<string, unknown> | null;
};

export type AutumnFeature = {
  id: string;
  name: string;
  type: "boolean" | "metered" | "credit_system" | string;
  archived: boolean;
};

/** Seats of a license plan bought on its parent plan, as Autumn's Licenses hold them (#862): `quantity` is all of them. */
export type SeatQuantity = { licensePlanId: string; quantity: number };

const licenseQuantities = (seats?: SeatQuantity) => (seats ? { license_quantities: [{ license_plan_id: seats.licensePlanId, quantity: seats.quantity }] } : {});

/** What a change would charge now, as Autumn previews it. A line's `period` is what it pays for, in ms. */
export type AutumnPreview = {
  total: number;
  currency: string;
  line_items: Array<{ description: string; total: number; plan_id?: string | null; period?: { start: number; end: number } | null }>;
  next_cycle?: { starts_at: number; total: number } | null;
  redirect_to_checkout: boolean;
};

/** What a change Autumn bills answers: a page to pay on when the card can't be charged without one, and why a charge failed. */
export type AutumnCharge = {
  payment_url: string | null;
  /** The invoice the change made, when it charged anything: `total` is in the currency's main unit. */
  invoice?: { status: string | null; stripe_id?: string; total?: number; currency?: string; hosted_invoice_url?: string | null } | null;
  required_action?: { code: string; reason?: string } | null;
};

/**
 * Dollars of a balance sold at a dollar each, bought as exactly `amount` of them for `amount` dollars, on one line of
 * the invoice: the purchase carries its own price for the lot. By the plan's price alone, Autumn sells whole units
 * and rounds a fraction up.
 */
const exactly = (quantity?: { feature: string; amount: number }) =>
  quantity
    ? {
        feature_quantities: [{ feature_id: quantity.feature, quantity: quantity.amount }],
        customize: { items: [{ feature_id: quantity.feature, price: { amount: quantity.amount, billing_units: quantity.amount, billing_method: "prepaid", interval: "one_off" } }] },
      }
    : {};

/** A promotion code given with a purchase, as Autumn's `discounts` take it. */
const promotion = (code?: string) => (code ? { discounts: [{ promotion_code: code }] } : {});

/** A member's monthly credit cap as Autumn's usage limit on their entity, which every lock and track as the entity counts against. */
const capControls = (cap: number | null) => ({
  usage_limits: cap === null ? [] : [{ feature_id: "credits", limit: cap, interval: "month", anchor: "utc" }],
});

export class AutumnError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Autumn ${path} failed with ${status}: ${JSON.stringify(body)}`);
  }

  get code(): string | undefined {
    return typeof this.body === "object" && this.body !== null
      ? ((this.body as { code?: string }).code ?? undefined)
      : undefined;
  }
}

/** Calls that only read, or that Autumn answers the same way however often they're sent. */
const REPEATABLE = /(^customers\.get_or_create$|\.preview_[a-z_]+$|\.list$)/;

function config() {
  const url = process.env.AUTUMN_URL;
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("AUTUMN_URL and AUTUMN_SECRET_KEY must be set");
  }
  return { url, secretKey };
}

/** The languages Stripe's checkout comes in, by the site's locale; another gets Stripe's own guess from the browser. */
const STRIPE_LOCALES: Record<string, string> = { "en-US": "en", "en-GB": "en-GB", zh: "zh", fr: "fr", ja: "ja", pt: "pt", es: "es", de: "de" };

/**
 * What Stripe's checkout page takes a payment with, in the person's language. A typed card only, no Apple Pay, Google
 * Pay, Link or Amazon Pay (the user's choice, 2026-11-12): the Stripe account's card-only payment method configuration
 * (STRIPE_CARD_ONLY_CONFIG, one per Stripe account), or without it cards with Link hidden.
 */
function checkoutParams(locale: string | undefined) {
  const only = process.env.STRIPE_CARD_ONLY_CONFIG;
  const methods = only ? { payment_method_configuration: only } : { payment_method_types: ["card"], wallet_options: { link: { display: "never" } } };
  return { ...methods, locale: STRIPE_LOCALES[locale ?? ""] ?? "auto" };
}

async function call<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const { url, secretKey } = config();
  const send = () =>
    fetch(`${url}/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
  // A request that never got an answer (a dropped or stale connection) is sent once more when sending it twice changes
  // nothing: a read, or a change that carries its idempotency key. People saw it as a code that "couldn't be checked".
  const repeatable = idempotencyKey !== undefined || REPEATABLE.test(path);
  const response = await send().catch((error: unknown) => {
    if (!repeatable) throw error;
    console.warn(`[autumn] ${path} got no answer (${String(error).slice(0, 200)}); asking once more`);
    return send();
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON bodies are kept as text for the error log.
  }
  if (!response.ok) {
    const error = new AutumnError(path, response.status, data);
    console.error(`[autumn] ${error.message}`);
    // Autumn locks a customer while it changes their plan: a second purchase, plan or seat change made then is refused, and the person is told so.
    if (response.status === 423 && path.startsWith("billing.")) throw createError("BILLING_PLAN_CHANGE_CONFLICT", "Another billing change is under way. Try again in a moment.");
    throw error;
  }
  return data as T;
}

export const autumn = {
  listPlans() {
    return call<{ list: AutumnPlan[] }>("plans.list", {});
  },

  listFeatures() {
    return call<{ list: AutumnFeature[] }>("features.list", {});
  },

  /** The customer, with its card only when `card` is set (Autumn asks Stripe for it), each subscription's plan when `plans` is, and its invoices when `invoices` is. */
  customer(customerId: string, data: { email?: string; name?: string; card?: boolean; plans?: boolean; invoices?: boolean } = {}) {
    const { card, plans, invoices, ...profile } = data;
    const expand = [...(card ? ["payment_method"] : []), ...(plans ? ["subscriptions.plan"] : []), ...(invoices ? ["invoices"] : [])];
    return call<AutumnCustomer>("customers.get_or_create", {
      customer_id: customerId,
      ...(expand.length > 0 ? { expand } : {}),
      ...profile,
    });
  },

  /**
   * Holds `credits` until the lock is finalized, of `feature` when it isn't credits. `allowed: false` holds nothing.
   * With `entityId`, a member's entity (#652): its monthly usage limit, the member's cap, counts too. This server
   * never lets go of a lock at `expiresAt` by itself: whoever holds one finalizes it.
   */
  lock(args: {
    customerId: string;
    entityId?: string;
    feature?: string;
    credits: number;
    lockId: string;
    expiresAt: number;
  }) {
    return call<{ allowed: boolean; balance: AutumnBalance | null }>(
      "balances.check",
      {
        customer_id: args.customerId,
        ...(args.entityId ? { entity_id: args.entityId } : {}),
        feature_id: args.feature ?? "credits",
        required_balance: args.credits,
        lock: { enabled: true, lock_id: args.lockId, expires_at: args.expiresAt },
      },
    );
  },

  finalize(lockId: string, action: "confirm" | "release", credits?: number) {
    return call<{ success: boolean }>("balances.finalize", {
      lock_id: lockId,
      action,
      ...(credits === undefined ? {} : { override_value: credits }),
    });
  },

  /** Charges up to `credits`; stops at a zero balance, or at the cap of the member's entity it names. */
  track(args: {
    customerId: string;
    entityId?: string;
    credits: number;
    idempotencyKey: string;
    properties?: Record<string, string>;
  }) {
    return call<{ balance: AutumnBalance | null; deductions: Array<{ value: number }> }>(
      "balances.track",
      {
        customer_id: args.customerId,
        ...(args.entityId ? { entity_id: args.entityId } : {}),
        feature_id: "credits",
        value: args.credits,
        overage_behavior: "cap",
        ...(args.properties ? { properties: args.properties } : {}),
      },
      args.idempotencyKey,
    );
  },

  /**
   * Gives the customer a balance of `feature`: one that refills to `amount` every `interval`, one of `amount` that
   * stays until used (no `interval`), or one with no limit.
   */
  createBalance(args: { customerId: string; feature: string; idempotencyKey: string } & ({ amount: number; interval?: string } | { unlimited: true })) {
    return call<{ success: boolean }>(
      "balances.create",
      { customer_id: args.customerId, feature_id: args.feature, ...("unlimited" in args ? { unlimited: true } : { included_grant: args.amount, ...(args.interval && { reset: { interval: args.interval } }) }) },
      args.idempotencyKey,
    );
  },

  /** Sets what is left now of the customer's balance of `feature` that refills every `interval`. */
  setBalance(args: { customerId: string; feature: string; interval: string; left: number }) {
    return call<{ success: boolean }>("balances.update", { customer_id: args.customerId, feature_id: args.feature, interval: args.interval, current_balance: args.left });
  },

  /** Removes one of the customer's balances of `feature`, with whatever is left in it. */
  deleteBalance(args: { customerId: string; feature: string; balanceId: string }) {
    return call<{ success: boolean }>("balances.delete", { customer_id: args.customerId, feature_id: args.feature, balance_id: args.balanceId });
  },

  /**
   * Takes `amount` of `feature` from one of the customer's balances and no other, stopping at zero. Asked twice under
   * one `idempotencyKey`, Autumn refuses the second (409 `duplicate_idempotency_key`), so it is only ever taken once.
   */
  takeFrom(args: { customerId: string; feature: string; balanceId: string; amount: number; idempotencyKey: string }) {
    return call<unknown>("balances.update", { customer_id: args.customerId, feature_id: args.feature, balance_id: args.balanceId, add_to_balance: -args.amount }, args.idempotencyKey);
  },

  /** Removes `credits` from one balance, stopping at zero. For refunds. */
  removeFromBalance(args: { customerId: string; balanceId: string; credits: number }) {
    return call<unknown>("balances.update", {
      customer_id: args.customerId,
      feature_id: "credits",
      balance_id: args.balanceId,
      add_to_balance: -args.credits,
    });
  },

  /**
   * `newMonth` starts the billing month over at the new plan (#860); Autumn refuses it on a change it
   * schedules for the renewal. `seats` buys that many of a license plan with it (#862).
   */
  attach(args: {
    customerId: string;
    planId: string;
    credits?: number;
    successUrl?: string;
    idempotencyKey?: string;
    newMonth?: boolean;
    seats?: SeatQuantity;
    /** How much of a feature sold at a dollar a unit is bought, to the cent, in place of `credits`: dollars of a publication balance. */
    quantity?: { feature: string; amount: number };
    /** A promotion code of an Autumn reward, taken off the charge. */
    code?: string;
    /**
     * Billed by invoice and given at once, for a purchase quoted at nothing to a customer with no card: Autumn sends a
     * card-less customer to Stripe's page otherwise, even for $0. Only ever with a quote of nothing: anything owed
     * would be given unpaid.
     */
    unbilled?: boolean;
    /**
     * A report's payment made on Stripe's checkout (a customer with no card on file): a typed card only, in the
     * person's language. Plans keep Stripe's default page.
     */
    checkout?: { locale?: string };
  }) {
    return call<AutumnCharge>(
      "billing.attach",
      {
        customer_id: args.customerId,
        plan_id: args.planId,
        redirect_mode: "if_required",
        ...licenseQuantities(args.seats),
        ...(args.credits
          ? { feature_quantities: [{ feature_id: "credits", quantity: args.credits }] }
          : {}),
        ...exactly(args.quantity),
        ...(args.successUrl ? { success_url: args.successUrl } : {}),
        ...(args.newMonth ? { billing_cycle_anchor: "now" } : {}),
        ...(args.unbilled ? { invoice_mode: { enabled: true, enable_plan_immediately: true, finalize: true } } : {}),
        // Used only when Autumn sends the person to Stripe's checkout: a customer with no card on file.
        ...(args.checkout ? { checkout_session_params: checkoutParams(args.checkout.locale) } : {}),
        ...promotion(args.code),
      },
      args.idempotencyKey,
    );
  },

  /** What `attach` would charge now, with the same `newMonth`, `seats`, promotion `code` and `quantity`. */
  previewAttach(customerId: string, planId: string, newMonth: boolean, seats?: SeatQuantity, code?: string, quantity?: { feature: string; amount: number }) {
    return call<AutumnPreview>("billing.preview_attach", {
      customer_id: customerId,
      plan_id: planId,
      ...(newMonth ? { billing_cycle_anchor: "now" } : {}),
      ...licenseQuantities(seats),
      ...promotion(code),
      ...exactly(quantity),
    });
  },

  /**
   * Changes the customer's subscription to `planId`: cancels it (at once, refunding the rest of its
   * period, or at the renewal), takes back a cancellation, or sets how many seats it holds, each
   * added seat charged for the days left and each removed one credited to the next bill (#862).
   */
  update(args: {
    customerId: string;
    entityId?: string;
    planId: string;
    cancelAction?: "cancel_end_of_cycle" | "cancel_immediately" | "uncancel";
    seats?: SeatQuantity;
  }) {
    return call<AutumnCharge>("billing.update", {
      customer_id: args.customerId,
      ...(args.entityId ? { entity_id: args.entityId } : {}),
      plan_id: args.planId,
      redirect_mode: "if_required",
      ...(args.cancelAction ? { cancel_action: args.cancelAction } : {}),
      ...licenseQuantities(args.seats),
    });
  },

  /** What `update` would charge now for `seats`: negative when it's a credit on the next bill. */
  previewUpdate(customerId: string, planId: string, seats: SeatQuantity) {
    return call<AutumnPreview>("billing.preview_update", { customer_id: customerId, plan_id: planId, ...licenseQuantities(seats) });
  },

  /** Gives each entity a seat from the pool bought (#863), making the entity when it's new; one that has a seat keeps it. */
  assignSeats(args: { customerId: string; licensePlanId: string; featureId: string; members: Array<{ entityId: string; name: string }> }) {
    return call<{ success: boolean }>("licenses.attach", {
      customer_id: args.customerId,
      plan_id: args.licensePlanId,
      entities: args.members.map((member) => ({ entity_id: member.entityId, name: member.name, feature_id: args.featureId })),
    });
  },

  /** Returns the entities' seats to the pool; what the customer pays doesn't change. */
  releaseSeats(customerId: string, licensePlanId: string, entityIds: string[]) {
    return call<{ success: boolean }>("licenses.release", { customer_id: customerId, license_plan_id: licensePlanId, entity_ids: entityIds });
  },

  /** The customer's pools of seats: how many it has, how many are given out and how many are left. */
  seatPools(customerId: string) {
    return call<{ list: Array<{ license_plan_id: string; granted: number; usage: number; remaining: number }> }>("licenses.list", { customer_id: customerId });
  },

  /** The entities that hold a seat now. */
  seatHolders(customerId: string) {
    return call<{ list: Array<{ entity_id: string; license_plan_id: string }> }>("licenses.list_assignments", { customer_id: customerId, active: true });
  },

  /** Makes a member's entity with its monthly cap (null for none) before it's given a seat, so the cap is there from its first charge. */
  createEntity(args: { customerId: string; entityId: string; featureId: string; name: string; cap: number | null }) {
    return call<AutumnEntity>("entities.create", {
      customer_id: args.customerId,
      entity_id: args.entityId,
      feature_id: args.featureId,
      name: args.name,
      billing_controls: capControls(args.cap),
    });
  },

  /** Caps the credits a member's entity spends each calendar month (UTC); null takes the cap off. */
  setCap(customerId: string, entityId: string, cap: number | null) {
    return call<AutumnEntity>("entities.update", { customer_id: customerId, entity_id: entityId, billing_controls: capControls(cap) });
  },

  deleteEntity(customerId: string, entityId: string) {
    return call<{ success: boolean }>("entities.delete", { customer_id: customerId, entity_id: entityId });
  },

  /** A page of the customer's entities; `next_cursor` is null on the last. */
  listEntities(customerId: string, cursor: string | null, limit: number) {
    return call<{ list: AutumnEntity[]; next_cursor: string | null }>("entities.list", {
      customer_id: customerId,
      limit,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
  },

  portal(customerId: string, returnUrl: string) {
    return call<{ url: string }>("billing.open_customer_portal", {
      customer_id: customerId,
      return_url: returnUrl,
    });
  },
};
