import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import type { GenericActionCtx } from "convex/server";
import { components, internal, api } from "./_generated/api";
import { registerRoutes } from "@convex-dev/stripe";
import { clerkWebhook } from "./webhooks/clerk";
import { normalizeStripeWebhookSecret } from "./lib/stripeWebhookSecret";
import { requireAppUrl } from "./lib/env";
import type Stripe from "stripe";

const http = httpRouter();
const STRIPE_WEBHOOK_SECRET = normalizeStripeWebhookSecret(
  process.env.STRIPE_WEBHOOK_SECRET,
);

function getStripeObjectId(event: Stripe.Event): string | undefined {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : undefined;
}

function getStripeApiVersion(event: Stripe.Event): string | undefined {
  return typeof event.api_version === "string" ? event.api_version : undefined;
}

async function recordStripeEventFailure(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ctx.runMutation(internal.subscriptions.internal.markStripeEventFailed, {
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

async function runAuditedStripeHandler(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  handler: () => Promise<void>,
): Promise<void> {
  try {
    await handler();
    await ctx.runMutation(internal.subscriptions.internal.markStripeEventProcessed, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "processed",
    });
  } catch (error) {
    await recordStripeEventFailure(ctx, event, error);
    throw error;
  }
}

async function processInvoiceForGrantNonBlocking(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  invoice: any,
): Promise<void> {
  const args = {
    stripeInvoiceId: invoice.id,
    stripeEventId: event.id,
    stripeEventType: event.type,
    trigger: `webhook:${event.type}`,
    retryCount: 0,
  };

  try {
    await ctx.runAction(internal.credits.actions.processInvoiceForGrant, args);
  } catch (error) {
    const retryDelayMs = 60_000;
    const retryAt = Date.now() + retryDelayMs;
    const message = error instanceof Error ? error.message : String(error);

    await ctx.runMutation(internal.subscriptions.internal.markStripeEventRetrying, {
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
      internal.credits.actions.processInvoiceForGrant,
      {
        ...args,
        retryCount: 1,
      },
    );
  }
}

// Clerk webhook for user sync
http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: clerkWebhook,
});

// Zotero OAuth callback
http.route({
  path: "/api/zotero/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const oauthToken = url.searchParams.get("oauth_token");
    const oauthVerifier = url.searchParams.get("oauth_verifier");

    if (!oauthToken || !oauthVerifier) {
      return new Response("Missing OAuth parameters", { status: 400 });
    }

    const frontendUrl = requireAppUrl();
    try {
      const result = await ctx.runAction(api.zotero.actions.completeOAuth, {
        oauthToken,
        oauthVerifier,
      });

      if (!result.success) {
        return Response.redirect(
          `${frontendUrl}/?zotero_error=${encodeURIComponent(result.error || "Unknown error")}`,
          302,
        );
      }

      return Response.redirect(`${frontendUrl}/?zotero_connected=true`, 302);
    } catch (error) {
      console.error("Zotero OAuth callback error:", error);
      return Response.redirect(
        `${frontendUrl}/?zotero_error=${encodeURIComponent("OAuth failed")}`,
        302,
      );
    }
  }),
});

registerRoutes(http, components.stripe, {
  webhookPath: "/webhooks/stripe",
  STRIPE_WEBHOOK_SECRET,

  events: {
    /**
     * IDEMPOTENCY CONTRACT (INFRA-03):
     *
     * This handler is idempotent. Replaying the same checkout.session.completed event
     * produces identical outcomes:
     *
     * - Dedup gate: For subscription checkouts, triggers reconcileRecentPaidInvoicesFromStripe
     *   which converges on grantMonthlyCredits -- deduplicated by stripeInvoiceId (CRED-01).
     * - On replay: Reconciliation re-fetches invoices and attempts grants, but the dedup
     *   gate on stripeInvoiceId prevents double-grants. Balance unchanged.
     * - Side effects: stripeEventLogs updated to "processed" (idempotent by stripeEventId).
     *   Non-subscription checkouts (mode !== "subscription") are no-ops on every invocation.
     * - Verified: 2026-02-27
     */
    "checkout.session.completed": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(
          `[StripeWebhook] checkout.session.completed - id=${session.id} mode=${session.mode}`,
        );

        if (session.mode === "subscription") {
          const stripeCustomerId =
            typeof session.customer === "string" ? session.customer : session.customer?.id;
          if (stripeCustomerId) {
            try {
              await ctx.runAction(
                internal.credits.actions.reconcileRecentPaidInvoicesFromStripe,
                {
                  stripeCustomerId,
                  trigger: "checkout.session.completed",
                },
              );
            } catch (error) {
              console.error(
                "[StripeWebhook] failed to trigger immediate reconcile after checkout",
                error,
              );
            }
          }
        }
      });
    },

    /**
     * IDEMPOTENCY CONTRACT (INFRA-03):
     *
     * This handler is idempotent. Replaying the same payment_intent.succeeded event
     * produces identical outcomes:
     *
     * - Dedup gate: grantPurchasedCreditsFromPaymentIntent checks creditTransactions
     *   by stripePaymentIntentId. If a purchase transaction exists, returns "already_granted".
     * - On replay: selectPurchaseTransactionByPaymentIntent finds the existing purchase
     *   and short-circuits. No balance change, no duplicate transaction record.
     * - Side effects: stripeEventLogs updated to "processed" (idempotent by stripeEventId).
     *   Non-topup payments (billingType !== "credit_topup") are ignored on every invocation.
     * - Verified: 2026-02-27
     */
    "payment_intent.succeeded": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const stripeCustomerId =
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : paymentIntent.customer?.id;
        const stripeChargeId =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id;

        await ctx.runMutation(internal.credits.internal.grantPurchasedCreditsFromPaymentIntent, {
          stripePaymentIntentId: paymentIntent.id,
          stripeCustomerId,
          stripeChargeId,
          amountReceived: paymentIntent.amount_received || paymentIntent.amount || 0,
          currency: paymentIntent.currency,
          metadata: paymentIntent.metadata as Record<string, string>,
        });
      });
    },

    /**
     * IDEMPOTENCY CONTRACT (INFRA-03):
     *
     * This handler is idempotent. Replaying the same charge.refunded event produces
     * identical outcomes:
     *
     * - Dedup gate: reversePurchasedCreditsFromRefund uses cumulative reversal delta.
     *   It calculates targetReversedCredits from the charge's amountRefunded (cumulative
     *   from Stripe), subtracts alreadyReversedCredits (sum of existing refund transactions),
     *   and only deducts the delta. On replay, delta is 0 -- no further deduction.
     * - On replay: reversalDelta <= 0, returns "already_reversed". No balance change.
     * - Side effects: stripeEventLogs updated to "processed" (idempotent by stripeEventId).
     *   Charges with no stripePaymentIntentId are skipped on every invocation.
     * - Verified: 2026-02-27
     */
    "charge.refunded": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const charge = event.data.object as Stripe.Charge;
        const stripePaymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (!stripePaymentIntentId) {
          return;
        }

        await ctx.runMutation(internal.credits.internal.reversePurchasedCreditsFromRefund, {
          stripeChargeId: charge.id,
          stripePaymentIntentId,
          amountRefunded: charge.amount_refunded,
          chargeAmount: charge.amount,
        });
      });
    },

    "invoice.created": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        // Monthly credit grants are intentionally triggered only from invoice.paid.
      });
    },

    "invoice.finalized": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        // Monthly credit grants are intentionally triggered only from invoice.paid.
      });
    },

    /**
     * IDEMPOTENCY CONTRACT (INFRA-03):
     *
     * This handler is idempotent. Replaying the same invoice.paid event produces
     * identical outcomes:
     *
     * - Dedup gate: grantMonthlyCredits checks creditTransactions by stripeInvoiceId.
     *   If a transaction already exists for this invoice, returns "already_granted".
     * - On replay: processInvoiceForGrantNonBlocking calls grantMonthlyCredits which
     *   finds the existing creditTransaction and short-circuits. No balance change.
     * - Side effects: stripeEventLogs updated to "processed" (idempotent upsert by
     *   stripeEventId via runAuditedStripeHandler). Credit balance unchanged on replay.
     * - Verified: 2026-02-27
     */
    "invoice.paid": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        await processInvoiceForGrantNonBlocking(ctx, event, invoice);
      });
    },

    "invoice.payment_succeeded": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        // invoice.payment_succeeded is not used as a monthly-credit trigger.
      });
    },

    "invoice.payment_failed": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        const failedSubscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;

        if (!failedSubscriptionId) {
          return;
        }

        await ctx.runMutation(internal.subscriptions.internal.handlePaymentFailed, {
          stripeSubscriptionId: failedSubscriptionId,
        });
      });
    },

    "customer.subscription.created": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        // Re-fetch from Stripe API instead of trusting event payload (SUB-02)
        const eventSub = event.data.object as any;
        const eventItem = eventSub.items?.data?.[0];
        await ctx.runAction(internal.subscriptions.actions.handleSubscriptionWebhook, {
          stripeSubscriptionId: eventSub.id,
          eventId: event.id,
          eventStatus: eventSub.status,
          eventPriceId: eventItem?.price?.id,
        });
      });
    },

    "customer.subscription.updated": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        // Re-fetch from Stripe API instead of trusting event payload (SUB-02)
        const eventSub = event.data.object as any;
        const eventItem = eventSub.items?.data?.[0];
        await ctx.runAction(internal.subscriptions.actions.handleSubscriptionWebhook, {
          stripeSubscriptionId: eventSub.id,
          eventId: event.id,
          eventStatus: eventSub.status,
          eventPriceId: eventItem?.price?.id,
        });
      });
    },

    "customer.subscription.deleted": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const subscription = event.data.object as any;
        await ctx.runMutation(internal.subscriptions.internal.handleSubscriptionCanceled, {
          stripeSubscriptionId: subscription.id,
        });
      });
    },
  },

  onEvent: async (ctx, event) => {
    await ctx.runMutation(internal.subscriptions.internal.recordStripeEventReceived, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "received",
    });
  },
});

export default http;
