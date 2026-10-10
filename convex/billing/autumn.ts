/**
 * HTTP client for the self-hosted Autumn billing server. Only actions call it.
 * Every failed call logs the endpoint, status, and Autumn's response body.
 */

export type AutumnBalance = {
  remaining: number;
  /** What the customer's plans grant of the feature. */
  granted?: number;
  unlimited?: boolean;
  breakdown?: Array<{
    id: string;
    plan_id: string | null;
    remaining: number;
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
};

export type AutumnCustomer = {
  id: string;
  stripe_id: string | null;
  subscriptions: AutumnSubscription[];
  purchases?: Array<{ plan_id: string }>;
  balances: Partial<Record<string, AutumnBalance>>;
  /** Boolean features the customer has, keyed by feature id. */
  flags?: Record<string, unknown>;
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

function config() {
  const url = process.env.AUTUMN_URL;
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("AUTUMN_URL and AUTUMN_SECRET_KEY must be set");
  }
  return { url, secretKey };
}

async function call<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const { url, secretKey } = config();
  const response = await fetch(`${url}/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
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

  /** The customer, with its card only when `card` is set: Autumn asks Stripe for it. */
  customer(customerId: string, data: { email?: string; name?: string; card?: boolean } = {}) {
    const { card, ...profile } = data;
    return call<AutumnCustomer>("customers.get_or_create", {
      customer_id: customerId,
      ...(card ? { expand: ["payment_method"] } : {}),
      ...profile,
    });
  },

  /**
   * Holds `credits` until the lock is finalized. `allowed: false` holds nothing. With
   * `entityId`, a member's entity (#652): its monthly usage limit, the member's cap, counts too.
   */
  lock(args: {
    customerId: string;
    entityId?: string;
    credits: number;
    lockId: string;
    expiresAt: number;
  }) {
    return call<{ allowed: boolean; balance: AutumnBalance | null }>(
      "balances.check",
      {
        customer_id: args.customerId,
        ...(args.entityId ? { entity_id: args.entityId } : {}),
        feature_id: "credits",
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

  /** Removes `credits` from one balance, stopping at zero. For refunds. */
  removeFromBalance(args: { customerId: string; balanceId: string; credits: number }) {
    return call<unknown>("balances.update", {
      customer_id: args.customerId,
      feature_id: "credits",
      balance_id: args.balanceId,
      add_to_balance: -args.credits,
    });
  },

  /** `entityId` attaches the plan to one of the customer's entities, as a Team seat is (#652). */
  attach(args: {
    customerId: string;
    entityId?: string;
    planId: string;
    credits?: number;
    successUrl?: string;
    idempotencyKey?: string;
  }) {
    return call<{ payment_url: string | null; invoice?: { status: string } | null }>(
      "billing.attach",
      {
        customer_id: args.customerId,
        ...(args.entityId ? { entity_id: args.entityId } : {}),
        plan_id: args.planId,
        redirect_mode: "if_required",
        ...(args.credits
          ? { feature_quantities: [{ feature_id: "credits", quantity: args.credits }] }
          : {}),
        ...(args.successUrl ? { success_url: args.successUrl } : {}),
      },
      args.idempotencyKey,
    );
  },

  previewAttach(customerId: string, planId: string) {
    return call<{
      total: number;
      currency: string;
      line_items: Array<{ description: string; total: number }>;
      next_cycle?: { starts_at: number; total: number } | null;
      redirect_to_checkout: boolean;
    }>("billing.preview_attach", { customer_id: customerId, plan_id: planId });
  },

  /** Cancelling an entity's plan at once refunds the rest of its period and takes back what it granted. */
  update(args: {
    customerId: string;
    entityId?: string;
    planId: string;
    cancelAction: "cancel_end_of_cycle" | "cancel_immediately" | "uncancel";
  }) {
    return call<unknown>("billing.update", {
      customer_id: args.customerId,
      ...(args.entityId ? { entity_id: args.entityId } : {}),
      plan_id: args.planId,
      cancel_action: args.cancelAction,
    });
  },

  /** `cap` sets the credits the entity may spend each calendar month (UTC), as `setCap` does. */
  createEntity(args: { customerId: string; entityId: string; featureId: string; name: string; cap?: number }) {
    return call<AutumnEntity>("entities.create", {
      customer_id: args.customerId,
      entity_id: args.entityId,
      feature_id: args.featureId,
      name: args.name,
      ...(args.cap === undefined ? {} : { billing_controls: capControls(args.cap) }),
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
