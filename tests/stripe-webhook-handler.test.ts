import { describe, expect, it, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  getStripeObjectId,
  getStripeApiVersion,
  runAuditedStripeHandler,
  processInvoiceForGrantNonBlocking,
} from "../convex/lib/stripeWebhookHandlers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStripeEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_test_123",
    type: "invoice.paid",
    api_version: "2024-12-18.acacia",
    data: {
      object: { id: "obj_abc" },
    },
    ...overrides,
  } as unknown as Stripe.Event;
}

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runAction: vi.fn().mockResolvedValue(undefined),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };
}

// Symbols stand in for Convex internal function references
const mutationRefs = {
  markStripeEventProcessed: Symbol("markStripeEventProcessed"),
  markStripeEventFailed: Symbol("markStripeEventFailed"),
  markStripeEventRetrying: Symbol("markStripeEventRetrying"),
};

const actionRefs = {
  processInvoiceForGrant: Symbol("processInvoiceForGrant"),
};

// ---------------------------------------------------------------------------
// getStripeObjectId
// ---------------------------------------------------------------------------

describe("getStripeObjectId", () => {
  it("returns string id when event.data.object.id is a string", () => {
    const event = makeStripeEvent({
      data: {
        object: { id: "sub_abc123" },
      },
    });
    expect(getStripeObjectId(event)).toBe("sub_abc123");
  });

  it("returns undefined when event.data.object has no id", () => {
    const event = makeStripeEvent({
      data: {
        object: {},
      },
    });
    expect(getStripeObjectId(event)).toBeUndefined();
  });

  it("returns undefined when id is not a string", () => {
    const event = makeStripeEvent({
      data: {
        object: { id: 42 },
      },
    });
    expect(getStripeObjectId(event)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getStripeApiVersion
// ---------------------------------------------------------------------------

describe("getStripeApiVersion", () => {
  it("returns api_version string", () => {
    const event = makeStripeEvent({ api_version: "2024-12-18.acacia" });
    expect(getStripeApiVersion(event)).toBe("2024-12-18.acacia");
  });

  it("returns undefined when api_version is null", () => {
    const event = makeStripeEvent({ api_version: null });
    expect(getStripeApiVersion(event)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runAuditedStripeHandler
// ---------------------------------------------------------------------------

describe("runAuditedStripeHandler", () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("calls markStripeEventProcessed on success", async () => {
    const event = makeStripeEvent();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runAuditedStripeHandler(ctx as any, event, handler, mutationRefs as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);

    const [_ref, args] = ctx.runMutation.mock.calls[0];
    expect(args).toEqual(
      expect.objectContaining({
        stripeEventId: "evt_test_123",
        eventType: "invoice.paid",
        stripeObjectId: "obj_abc",
        classification: "processed",
      }),
    );
  });

  it("calls markStripeEventFailed and re-throws on handler error", async () => {
    const event = makeStripeEvent();
    const error = new Error("handler boom");
    const handler = vi.fn().mockRejectedValue(error);

    await expect(
      runAuditedStripeHandler(ctx as any, event, handler, mutationRefs as any),
    ).rejects.toThrow("handler boom");

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);

    const [_ref, args] = ctx.runMutation.mock.calls[0];
    expect(args).toEqual(
      expect.objectContaining({
        stripeEventId: "evt_test_123",
        eventType: "invoice.paid",
        classification: "webhook_handler_failure",
        errorMessage: "handler boom",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// processInvoiceForGrantNonBlocking
// ---------------------------------------------------------------------------

describe("processInvoiceForGrantNonBlocking", () => {
  let ctx: ReturnType<typeof createMockCtx>;

  const grantRefs = {
    processInvoiceForGrant: Symbol("processInvoiceForGrant"),
    markStripeEventRetrying: Symbol("markStripeEventRetrying"),
  };

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("calls processInvoiceForGrant with correct args on success", async () => {
    const event = makeStripeEvent({ id: "evt_inv_1", type: "invoice.paid" });
    const invoice = { id: "inv_001" } as unknown as Stripe.Invoice;

    await processInvoiceForGrantNonBlocking(ctx as any, event, invoice, grantRefs as any);

    expect(ctx.runAction).toHaveBeenCalledTimes(1);
    const [_ref, args] = ctx.runAction.mock.calls[0];
    expect(args).toEqual({
      stripeInvoiceId: "inv_001",
      stripeEventId: "evt_inv_1",
      stripeEventType: "invoice.paid",
      trigger: "webhook:invoice.paid",
      retryCount: 0,
    });
  });

  it("schedules retry with 60s delay and retryCount=1 on failure", async () => {
    const event = makeStripeEvent({ id: "evt_inv_2", type: "invoice.paid" });
    const invoice = { id: "inv_002" } as unknown as Stripe.Invoice;
    ctx.runAction.mockRejectedValueOnce(new Error("transient error"));

    await processInvoiceForGrantNonBlocking(ctx as any, event, invoice, grantRefs as any);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
    const [delay, _ref, args] = ctx.scheduler.runAfter.mock.calls[0];
    expect(delay).toBe(60_000);
    expect(args).toEqual(
      expect.objectContaining({
        stripeInvoiceId: "inv_002",
        stripeEventId: "evt_inv_2",
        retryCount: 1,
      }),
    );
  });

  it("calls markStripeEventRetrying on failure", async () => {
    const event = makeStripeEvent({ id: "evt_inv_3", type: "invoice.paid" });
    const invoice = { id: "inv_003" } as unknown as Stripe.Invoice;
    ctx.runAction.mockRejectedValueOnce(new Error("db timeout"));

    await processInvoiceForGrantNonBlocking(ctx as any, event, invoice, grantRefs as any);

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [_ref, args] = ctx.runMutation.mock.calls[0];
    expect(args).toEqual(
      expect.objectContaining({
        stripeEventId: "evt_inv_3",
        eventType: "invoice.paid",
        classification: "retry_invoice_grant_process",
      }),
    );
    // Verify reason contains the error message
    expect(args.reason).toContain("db timeout");
  });
});
