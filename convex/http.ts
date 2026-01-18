import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import { registerRoutes } from "@convex-dev/stripe";
import { workosWebhook } from "./webhooks/workos";

const http = httpRouter();

// WorkOS webhook for user/org/membership sync
http.route({
  path: "/webhooks/workos",
  method: "POST",
  handler: workosWebhook,
});

// Stripe webhook via component
registerRoutes(http, components.stripe, {
  webhookPath: "/webhooks/stripe",
  
  // Custom handlers for your credit/subscription logic
  events: {
    "checkout.session.completed": async (ctx, event) => {
      const session = event.data.object as any;
      if (session.mode === "payment") {
        // One-time credit purchase
        await ctx.runMutation(internal.credits.internal.handleCreditPurchase, {
          stripeCustomerId: session.customer as string,
          amountPaid: session.amount_total ?? 0,
          metadata: session.metadata ?? {},
          stripeInvoiceId: session.id,
        });
      } else if (session.mode === "subscription") {
        // 1. Link subscription immediately
        await ctx.runMutation(internal.subscriptions.internal.handleCheckoutComplete, {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          metadata: session.metadata as Record<string, string> ?? {},
        });

      }
    },
    
    "invoice.paid": async (ctx, event) => {
      const invoice = event.data.object as any;
      
      // Handle subscription ID - could be string or object depending on API version
      let subscriptionId: string | null = null;
      if (typeof invoice.subscription === "string") {
        subscriptionId = invoice.subscription;
      } else if (invoice.subscription?.id) {
        subscriptionId = invoice.subscription.id;
      }
      
      console.log(`[StripeWebhook] Processing invoice.paid: ${invoice.id}, Sub: ${subscriptionId}, Customer: ${invoice.customer}`);
      
      if (subscriptionId || invoice.customer) {
        console.log(`[StripeWebhook] Granting credits for subscription: ${subscriptionId ?? "(fallback by customer)"}`);
        await ctx.runMutation(internal.credits.internal.grantMonthlyCredits, {
          stripeSubscriptionId: subscriptionId ?? undefined,
          stripeCustomerId: invoice.customer as string | undefined,
          stripeInvoiceId: invoice.id,
          amountPaid: invoice.amount_paid,
        });
      } else {
        console.log(`[StripeWebhook] Skipping credit grant: No subscription or customer on invoice ${invoice.id}`);
      }
    },

    "invoice.payment_failed": async (ctx, event) => {
      const invoice = event.data.object as any;
      console.log(`[StripeWebhook] Payment failed for invoice: ${invoice.id}`);
      if (invoice.subscription) {
        const failedSubscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
        if (failedSubscriptionId) {
          await ctx.runMutation(internal.subscriptions.internal.handlePaymentFailed, {
            stripeSubscriptionId: failedSubscriptionId,
          });
        }
      }
    },

    "customer.subscription.created": async (ctx, event) => {
      const subscription = event.data.object as any;
      const currentPeriodStart = (subscription.current_period_start as number) ?? Math.floor(Date.now() / 1000);
      const currentPeriodEnd = (subscription.current_period_end as number) ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const items = subscription.items as { data?: Array<{ price?: { id?: string }; quantity?: number }> };

      await ctx.runMutation(internal.subscriptions.internal.syncSubscription, {
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer as string,
        status: mapStripeStatus(subscription.status),
        currentPeriodStart: currentPeriodStart * 1000,
        currentPeriodEnd: currentPeriodEnd * 1000,
        cancelAtPeriodEnd: (subscription.cancel_at_period_end as boolean) ?? false,
        priceId: items.data?.[0]?.price?.id,
        quantity: items.data?.[0]?.quantity,
        metadata: subscription.metadata as Record<string, string>,
      });
    },

    "customer.subscription.updated": async (ctx, event) => {
      const subscription = event.data.object as any;
      const currentPeriodStart = (subscription.current_period_start as number) ?? Math.floor(Date.now() / 1000);
      const currentPeriodEnd = (subscription.current_period_end as number) ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const items = subscription.items as { data?: Array<{ price?: { id?: string }; quantity?: number }> };

      await ctx.runMutation(internal.subscriptions.internal.syncSubscription, {
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer as string,
        status: mapStripeStatus(subscription.status),
        currentPeriodStart: currentPeriodStart * 1000,
        currentPeriodEnd: currentPeriodEnd * 1000,
        cancelAtPeriodEnd: (subscription.cancel_at_period_end as boolean) ?? false,
        priceId: items.data?.[0]?.price?.id,
        quantity: items.data?.[0]?.quantity,
        metadata: subscription.metadata as Record<string, string>,
      });
    },

    "customer.subscription.deleted": async (ctx, event) => {
      const subscription = event.data.object as any;
      await ctx.runMutation(internal.subscriptions.internal.handleSubscriptionCanceled, {
        stripeSubscriptionId: subscription.id,
      });
    },
  },
  
  onEvent: async (ctx, event) => {
    console.log("Stripe event:", event.type, event.id);
  },
});

export default http;

function mapStripeStatus(
  status: string
): "active" | "past_due" | "canceled" | "trialing" {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "trialing":
      return "trialing";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
    case "incomplete":
      return "canceled";
    default:
      return "active";
  }
}

