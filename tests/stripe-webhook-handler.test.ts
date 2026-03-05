import { describe, expect, it, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  getStripeObjectId,
  getStripeApiVersion,
  runAuditedStripeHandler,
  processInvoiceForGrantNonBlocking,
} from "../convex/lib/stripeWebhookHandlers";
import {
  createMockStripeEvent,
  createMockStripeInvoice,
  createMockActionCtx,
  createMockMutationRefs,
  createMockGrantRefs,
} from "./factories";
import type { GenericActionCtx, GenericDataModel } from "convex/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStripeEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return createMockStripeEvent(overrides);
}

const mutationRefs = createMockMutationRefs();

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
  let ctx: GenericActionCtx<GenericDataModel>;

  beforeEach(() => {
    ctx = createMockActionCtx({
      runMutation: vi.fn().mockResolvedValue(undefined),
      runAction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as GenericActionCtx<GenericDataModel>;
  });

  it("calls markStripeEventProcessed on success", async () => {
    const event = makeStripeEvent();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runAuditedStripeHandler(ctx, event, handler, mutationRefs);

    expect(handler).toHaveBeenCalledTimes(1);
    const runMutation = ctx.runMutation as ReturnType<typeof vi.fn>;
    expect(runMutation).toHaveBeenCalledTimes(1);

    const [_ref, args] = runMutation.mock.calls[0];
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
      runAuditedStripeHandler(ctx, event, handler, mutationRefs),
    ).rejects.toThrow("handler boom");

    const runMutation = ctx.runMutation as ReturnType<typeof vi.fn>;
    expect(runMutation).toHaveBeenCalledTimes(1);

    const [_ref, args] = runMutation.mock.calls[0];
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
  let ctx: GenericActionCtx<GenericDataModel>;
  let runAction: ReturnType<typeof vi.fn>;
  let runMutation: ReturnType<typeof vi.fn>;
  let schedulerRunAfter: ReturnType<typeof vi.fn>;

  const grantRefs = createMockGrantRefs();

  beforeEach(() => {
    runAction = vi.fn().mockResolvedValue(undefined);
    runMutation = vi.fn().mockResolvedValue(undefined);
    schedulerRunAfter = vi.fn().mockResolvedValue(undefined);
    ctx = createMockActionCtx({
      runAction,
      runMutation,
      scheduler: { runAfter: schedulerRunAfter },
    }) as unknown as GenericActionCtx<GenericDataModel>;
  });

  it("calls processInvoiceForGrant with correct args on success", async () => {
    const event = makeStripeEvent({ id: "evt_inv_1", type: "invoice.paid" });
    const invoice = createMockStripeInvoice({ id: "inv_001" });

    await processInvoiceForGrantNonBlocking(ctx, event, invoice, grantRefs);

    expect(runAction).toHaveBeenCalledTimes(1);
    const [_ref, args] = runAction.mock.calls[0];
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
    const invoice = createMockStripeInvoice({ id: "inv_002" });
    runAction.mockRejectedValueOnce(new Error("transient error"));

    await processInvoiceForGrantNonBlocking(ctx, event, invoice, grantRefs);

    expect(schedulerRunAfter).toHaveBeenCalledTimes(1);
    const [delay, _ref, args] = schedulerRunAfter.mock.calls[0];
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
    const invoice = createMockStripeInvoice({ id: "inv_003" });
    runAction.mockRejectedValueOnce(new Error("db timeout"));

    await processInvoiceForGrantNonBlocking(ctx, event, invoice, grantRefs);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const [_ref, args] = runMutation.mock.calls[0];
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
