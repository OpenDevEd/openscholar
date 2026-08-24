import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal, api } from "./_generated/api";
import { registerRoutes } from "@convex-dev/stripe";
import { clerkWebhook } from "./webhooks/clerk";
import { redeemAdminLoginCode } from "./evidenceLibraries/serviceHttp";
import { normalizeStripeWebhookSecret } from "./lib/stripeWebhookSecret";
import { requireAppUrl } from "./lib/env";
import {
  getStripeObjectId,
  getStripeApiVersion,
  runAuditedStripeHandler as _runAuditedStripeHandler,
  processInvoiceForGrantNonBlocking as _processInvoiceForGrantNonBlocking,
} from "./lib/stripeWebhookHandlers";
import type Stripe from "stripe";
import {
  handleChatCompletions,
  handleModelsV1,
  handleBalance,
  handleCors,
} from "./wallet/gateway/handler";

const http = httpRouter();
const STRIPE_WEBHOOK_SECRET = normalizeStripeWebhookSecret(
  process.env.STRIPE_WEBHOOK_SECRET,
);

// Bind extracted helpers to the real Convex internal refs used by this module
const auditRefs = {
  markStripeEventProcessed: internal.subscriptions.internal.markStripeEventProcessed,
  markStripeEventFailed: internal.subscriptions.internal.markStripeEventFailed,
};

const invoiceGrantRefs = {
  processInvoiceForGrant: internal.credits.actions.processInvoiceForGrant,
  markStripeEventRetrying: internal.subscriptions.internal.markStripeEventRetrying,
};

function runAuditedStripeHandler(
  ctx: Parameters<typeof _runAuditedStripeHandler>[0],
  event: Stripe.Event,
  handler: () => Promise<void>,
) {
  return _runAuditedStripeHandler(ctx, event, handler, auditRefs);
}

function processInvoiceForGrantNonBlocking(
  ctx: Parameters<typeof _processInvoiceForGrantNonBlocking>[0],
  event: Stripe.Event,
  invoice: Stripe.Invoice,
) {
  return _processInvoiceForGrantNonBlocking(ctx, event, invoice, invoiceGrantRefs);
}

// Clerk webhook for user sync
http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: clerkWebhook,
});

http.route({
  path: "/api/evidence-libraries/admin-login/redeem",
  method: "POST",
  handler: redeemAdminLoginCode,
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
      const result = await ctx.runAction(internal.zotero.actions.completeOAuth, {
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
          `[StripeWebhook] checkout.session.completed - id=${session.id} mode=${session.mode} payment_status=${session.payment_status}`,
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

        // Fulfillment for one-time payments (credit top-ups).
        // Per Stripe docs, checkout.session.completed is the recommended
        // fulfillment event — it fires for all payment scenarios including
        // 100% discount / no-cost orders where payment_intent.succeeded
        // never fires. See: https://docs.stripe.com/checkout/fulfillment
        if (session.mode === "payment" && session.payment_status !== "unpaid") {
          const stripeCustomerId =
            typeof session.customer === "string" ? session.customer : session.customer?.id;
          const stripePaymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? undefined;

          await ctx.runMutation(internal.credits.internal.grantPurchasedCreditsFromCheckout, {
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId,
            stripeCustomerId: stripeCustomerId ?? undefined,
            amountTotal: session.amount_total ?? 0,
            currency: session.currency ?? undefined,
            paymentStatus: session.payment_status ?? "unknown",
            metadata: (session.metadata ?? {}) as Record<string, string>,
          });
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
        const invoice = event.data.object as Stripe.Invoice;
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
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        const failedSubscriptionId =
          typeof subRef === "string" ? subRef : subRef?.id;

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
        const eventSub = event.data.object as Stripe.Subscription;
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
        const eventSub = event.data.object as Stripe.Subscription;
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
        const subscription = event.data.object as Stripe.Subscription;
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

// ─── Wallet AI Gateway (OpenAI-compatible) ──────────────────

http.route({
  path: "/api/wallet/v1/chat/completions",
  method: "POST",
  handler: handleChatCompletions,
});

http.route({
  path: "/api/wallet/v1/chat/completions",
  method: "OPTIONS",
  handler: handleCors,
});

http.route({
  path: "/api/wallet/v1/models",
  method: "GET",
  handler: handleModelsV1,
});

http.route({
  path: "/api/wallet/v1/models",
  method: "OPTIONS",
  handler: handleCors,
});

http.route({
  path: "/api/wallet/balance",
  method: "GET",
  handler: handleBalance,
});

http.route({
  path: "/api/wallet/balance",
  method: "OPTIONS",
  handler: handleCors,
});

export default http;
