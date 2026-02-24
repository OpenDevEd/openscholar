import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal, api } from "./_generated/api";
import { registerRoutes } from "@convex-dev/stripe";
import { clerkWebhook } from "./webhooks/clerk";
import { normalizeStripeSubscriptionStatus } from "./subscriptions/lib/stripeStatus";
import { isSubscriptionScheduledToCancel } from "./subscriptions/lib/cancellation";
import type Stripe from "stripe";

const http = httpRouter();
const internalApi = internal as any;
const FRONTEND_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_URL ||
  "http://localhost:3000";

function getStripeObjectId(event: Stripe.Event): string | undefined {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : undefined;
}

function getStripeApiVersion(event: Stripe.Event): string | undefined {
  return typeof event.api_version === "string" ? event.api_version : undefined;
}

async function recordStripeEventFailure(
  ctx: any,
  event: Stripe.Event,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventFailed, {
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
  ctx: any,
  event: Stripe.Event,
  handler: () => Promise<void>,
): Promise<void> {
  try {
    await handler();
    await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventProcessed, {
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
  ctx: any,
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
    await ctx.runAction(internalApi.credits.actions.processInvoiceForGrant, args);
  } catch (error) {
    const retryDelayMs = 60_000;
    const retryAt = Date.now() + retryDelayMs;
    const message = error instanceof Error ? error.message : String(error);

    await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventRetrying, {
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
      internalApi.credits.actions.processInvoiceForGrant,
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

    try {
      const result = await ctx.runAction(api.zotero.actions.completeOAuth, {
        oauthToken,
        oauthVerifier,
      });

      if (!result.success) {
        return Response.redirect(
          `${FRONTEND_URL}/?zotero_error=${encodeURIComponent(result.error || "Unknown error")}`,
          302,
        );
      }

      return Response.redirect(`${FRONTEND_URL}/?zotero_connected=true`, 302);
    } catch (error) {
      console.error("Zotero OAuth callback error:", error);
      return Response.redirect(
        `${FRONTEND_URL}/?zotero_error=${encodeURIComponent("OAuth failed")}`,
        302,
      );
    }
  }),
});

registerRoutes(http, components.stripe, {
  webhookPath: "/webhooks/stripe",

  events: {
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
                internalApi.credits.actions.reconcileRecentPaidInvoicesFromStripe,
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

    "invoice.created": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        await processInvoiceForGrantNonBlocking(ctx, event, invoice);
      });
    },

    "invoice.finalized": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        await processInvoiceForGrantNonBlocking(ctx, event, invoice);
      });
    },

    "invoice.paid": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        await processInvoiceForGrantNonBlocking(ctx, event, invoice);
      });
    },

    "invoice.payment_succeeded": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const invoice = event.data.object as any;
        await processInvoiceForGrantNonBlocking(ctx, event, invoice);
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

        await ctx.runMutation(internalApi.subscriptions.internal.handlePaymentFailed, {
          stripeSubscriptionId: failedSubscriptionId,
        });
      });
    },

    "customer.subscription.created": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const subscription = event.data.object as any;
        const item = subscription.items.data[0];
        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const currentPeriodEnd =
          subscription.current_period_end ??
          item?.current_period_end ??
          Math.floor(Date.now() / 1000);

        await ctx.runMutation(internalApi.subscriptions.internal.syncSubscription, {
          stripeSubscriptionId: subscription.id,
          stripeCustomerId,
          status: normalizeStripeSubscriptionStatus(subscription.status),
          currentPeriodStart:
            (subscription.current_period_start ?? item?.current_period_start ?? Math.floor(Date.now() / 1000)) *
            1000,
          currentPeriodEnd:
            currentPeriodEnd *
            1000,
          cancelAtPeriodEnd: isSubscriptionScheduledToCancel({
            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
            cancelAt: subscription.cancel_at ?? null,
            currentPeriodEnd,
          }),
          priceId: item?.price?.id,
          quantity: item?.quantity,
          metadata: subscription.metadata as Record<string, string>,
        });
      });
    },

    "customer.subscription.updated": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const subscription = event.data.object as any;
        const item = subscription.items.data[0];
        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const currentPeriodEnd =
          subscription.current_period_end ??
          item?.current_period_end ??
          Math.floor(Date.now() / 1000);

        await ctx.runMutation(internalApi.subscriptions.internal.syncSubscription, {
          stripeSubscriptionId: subscription.id,
          stripeCustomerId,
          status: normalizeStripeSubscriptionStatus(subscription.status),
          currentPeriodStart:
            (subscription.current_period_start ?? item?.current_period_start ?? Math.floor(Date.now() / 1000)) *
            1000,
          currentPeriodEnd:
            currentPeriodEnd *
            1000,
          cancelAtPeriodEnd: isSubscriptionScheduledToCancel({
            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
            cancelAt: subscription.cancel_at ?? null,
            currentPeriodEnd,
          }),
          priceId: item?.price?.id,
          quantity: item?.quantity,
          metadata: subscription.metadata as Record<string, string>,
        });
      });
    },

    "customer.subscription.deleted": async (ctx, event) => {
      await runAuditedStripeHandler(ctx, event, async () => {
        const subscription = event.data.object as any;
        await ctx.runMutation(internalApi.subscriptions.internal.handleSubscriptionCanceled, {
          stripeSubscriptionId: subscription.id,
        });
      });
    },
  },

  onEvent: async (ctx, event) => {
    await ctx.runMutation(internalApi.subscriptions.internal.recordStripeEventReceived, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeObjectId: getStripeObjectId(event),
      stripeApiVersion: getStripeApiVersion(event),
      classification: "received",
    });
  },
});

export default http;
