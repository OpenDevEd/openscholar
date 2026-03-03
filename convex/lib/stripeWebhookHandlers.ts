import type { FunctionReference, GenericActionCtx } from "convex/server";
import type Stripe from "stripe";

/**
 * Pure utility -- extracts .id from event data object.
 */
export function getStripeObjectId(event: Stripe.Event): string | undefined {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : undefined;
}

/**
 * Pure utility -- extracts api_version string.
 */
export function getStripeApiVersion(event: Stripe.Event): string | undefined {
  return typeof event.api_version === "string" ? event.api_version : undefined;
}

/**
 * Records failure in stripeEventLogs.
 */
export async function recordStripeEventFailure(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  error: unknown,
  markStripeEventFailed: FunctionReference<"mutation", "internal">,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ctx.runMutation(markStripeEventFailed, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "webhook_handler_failure",
      errorMessage: message,
    });
  } catch (markError) {
    console.error("Failed to mark Stripe event as failed", markError);
  }
}

/**
 * Wraps handler with success/failure audit logging.
 */
export async function runAuditedStripeHandler(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  handler: () => Promise<void>,
  refs: {
    markStripeEventProcessed: FunctionReference<"mutation", "internal">;
    markStripeEventFailed: FunctionReference<"mutation", "internal">;
  },
): Promise<void> {
  try {
    await handler();
    await ctx.runMutation(refs.markStripeEventProcessed, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "processed",
    });
  } catch (error) {
    await recordStripeEventFailure(
      ctx,
      event,
      error,
      refs.markStripeEventFailed,
    );
    throw error;
  }
}

/**
 * Calls processInvoiceForGrant, retries on failure with 60s delay.
 */
export async function processInvoiceForGrantNonBlocking(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
  refs: {
    processInvoiceForGrant: FunctionReference<"action", "internal">;
    markStripeEventRetrying: FunctionReference<"mutation", "internal">;
  },
): Promise<void> {
  const args = {
    stripeInvoiceId: invoice.id,
    stripeEventId: event.id,
    stripeEventType: event.type,
    trigger: `webhook:${event.type}`,
    retryCount: 0,
  };

  try {
    await ctx.runAction(refs.processInvoiceForGrant, args);
  } catch (error) {
    const retryDelayMs = 60_000;
    const retryAt = Date.now() + retryDelayMs;
    const message = error instanceof Error ? error.message : String(error);

    await ctx.runMutation(refs.markStripeEventRetrying, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "retry_invoice_grant_process",
      retryAt,
      reason: `Failed to process invoice grant action: ${message}`,
    });

    await ctx.scheduler.runAfter(
      retryDelayMs,
      refs.processInvoiceForGrant,
      {
        ...args,
        retryCount: 1,
      },
    );
  }
}
