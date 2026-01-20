import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal, api } from "./_generated/api";
import { registerRoutes } from "@convex-dev/stripe";
import { workosWebhook } from "./webhooks/workos";

const http = httpRouter();

// WorkOS webhook for user/org/membership sync
http.route({
  path: "/webhooks/workos",
  method: "POST",
  handler: workosWebhook,
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
        // Redirect to error page
        const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        return Response.redirect(
          `${frontendUrl}/extraction?zotero_error=${encodeURIComponent(result.error || "Unknown error")}`,
          302
        );
      }

      // Redirect to success page
      const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return Response.redirect(`${frontendUrl}/extraction?zotero_connected=true`, 302);
    } catch (error) {
      console.error("Zotero OAuth callback error:", error);
      const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return Response.redirect(
        `${frontendUrl}/extraction?zotero_error=${encodeURIComponent("OAuth failed")}`,
        302
      );
    }
  }),
});

// Stripe webhook via component
registerRoutes(http, components.stripe, {
  webhookPath: "/webhooks/stripe",
  
  // Custom handlers for your credit/subscription logic
  events: {
    "checkout.session.completed": async (ctx, event) => {
      const session = event.data.object as any;
      console.log(`[Webhook] checkout.session.completed - Mode: ${session.mode}, Customer: ${session.customer}`);
      
      if (session.mode === "payment") {
        // One-time credit purchase
        console.log(`[Webhook] Processing one-time payment: ${session.id}`);
        await ctx.runMutation(internal.credits.internal.handleCreditPurchase, {
          stripeCustomerId: session.customer as string,
          amountPaid: session.amount_total ?? 0,
          metadata: session.metadata ?? {},
          stripeInvoiceId: session.id,
        });
      }
      // NOTE: For subscription mode, we rely on customer.subscription.created/updated events
      // This follows Stripe's best practice of using subscription events as the source of truth
      // checkout.session.completed is only used for one-time payments
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

      console.log(`[Webhook] customer.subscription.created - ID: ${subscription.id}, Customer: ${subscription.customer}, Status: ${subscription.status}, Price: ${items.data?.[0]?.price?.id}`);

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

      console.log(`[Webhook] customer.subscription.updated - ID: ${subscription.id}, Status: ${subscription.status}, Price: ${items.data?.[0]?.price?.id}, CancelAtPeriodEnd: ${subscription.cancel_at_period_end}`);

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
      console.log(`[Webhook] customer.subscription.deleted - ID: ${subscription.id}`);
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

