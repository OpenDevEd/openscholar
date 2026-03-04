import type Stripe from "stripe";
import type { FunctionReference } from "convex/server";

// ---------------------------------------------------------------------------
// Stripe event factory
// ---------------------------------------------------------------------------

export function createMockStripeEvent(overrides?: Record<string, unknown>): Stripe.Event {
  const base = {
    id: "evt_test_123",
    type: "invoice.paid",
    api_version: "2024-12-18.acacia",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: { id: "obj_abc" },
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    object: "event" as const,
    ...overrides,
  };
  return base as unknown as Stripe.Event;
}

// ---------------------------------------------------------------------------
// Stripe invoice factory
// ---------------------------------------------------------------------------

export function createMockStripeInvoice(overrides?: Record<string, unknown>): Stripe.Invoice {
  const base = {
    id: "inv_test_123",
    object: "invoice" as const,
    ...overrides,
  };
  return base as unknown as Stripe.Invoice;
}

// ---------------------------------------------------------------------------
// Convex function reference factories (for webhook handler tests)
// ---------------------------------------------------------------------------

export function createMockMutationRefs() {
  return {
    markStripeEventProcessed: Symbol("markStripeEventProcessed"),
    markStripeEventFailed: Symbol("markStripeEventFailed"),
    markStripeEventRetrying: Symbol("markStripeEventRetrying"),
  } as unknown as {
    markStripeEventProcessed: FunctionReference<"mutation", "internal">;
    markStripeEventFailed: FunctionReference<"mutation", "internal">;
    markStripeEventRetrying: FunctionReference<"mutation", "internal">;
  };
}

export function createMockGrantRefs() {
  return {
    processInvoiceForGrant: Symbol("processInvoiceForGrant"),
    markStripeEventRetrying: Symbol("markStripeEventRetrying"),
  } as unknown as {
    processInvoiceForGrant: FunctionReference<"action", "internal">;
    markStripeEventRetrying: FunctionReference<"mutation", "internal">;
  };
}
