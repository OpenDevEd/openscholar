import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { api } from "../_generated/api";

export const stripeWebhook = httpAction(async (ctx, req) => {
  const payload = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!sigHeader) {
    return new Response("Missing signature", { status: 401 });
  }

  // Verify signature using Node.js action
  const result = await ctx.runAction(api.webhooks.actions.verifyStripeWebhook, {
    payload,
    signature: sigHeader,
  });

  if (!result.success) {
    console.error("Stripe webhook verification failed:", result.error);
    return new Response("Invalid signature", { status: 401 });
  }

  const eventType = result.type;
  const eventData = result.data;
  console.log(`Stripe Webhook Received: ${eventType} (${eventData.id})`);

  try {
    switch (eventType) {
      // ── Checkout ─────────────────────────────────────────────────
      case "checkout.session.completed": {
        const mode = eventData.mode as string;

        if (mode === "subscription") {
          await ctx.runMutation(
            internal.subscriptions.internal.handleCheckoutComplete,
            {
              stripeCustomerId: eventData.customer as string,
              stripeSubscriptionId: eventData.subscription as string,
              metadata: (eventData.metadata as Record<string, string>) ?? {},
            }
          );
        } else if (mode === "payment") {
          // One-time credit purchase
          await ctx.runMutation(internal.credits.internal.handleCreditPurchase, {
            stripeCustomerId: eventData.customer as string,
            amountPaid: (eventData.amount_total as number) ?? 0,
            metadata: (eventData.metadata as Record<string, string>) ?? {},
            stripeInvoiceId: (eventData.invoice as string) || (eventData.id as string), // Use invoice ID or event ID (for checkout sessions)
          });
        }
        break;
      }

      // ── Subscription Lifecycle ───────────────────────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const currentPeriodStart = (eventData.current_period_start as number) ?? Math.floor(Date.now() / 1000);
        const currentPeriodEnd = (eventData.current_period_end as number) ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        const items = eventData.items as { data?: Array<{ price?: { id?: string }; quantity?: number }> };

        await ctx.runMutation(internal.subscriptions.internal.syncSubscription, {
          stripeSubscriptionId: eventData.id as string,
          stripeCustomerId: eventData.customer as string,
          status: mapStripeStatus(eventData.status as string),
          currentPeriodStart: currentPeriodStart * 1000,
          currentPeriodEnd: currentPeriodEnd * 1000,
          cancelAtPeriodEnd: (eventData.cancel_at_period_end as boolean) ?? false,
          priceId: items.data?.[0]?.price?.id,
          quantity: items.data?.[0]?.quantity,
          metadata: eventData.metadata as Record<string, string>,
        });
        break;
      }

      case "customer.subscription.deleted": {
        await ctx.runMutation(
          internal.subscriptions.internal.handleSubscriptionCanceled,
          {
            stripeSubscriptionId: eventData.id as string,
          }
        );
        break;
      }

      // ── Invoice Events ───────────────────────────────────────────
      case "invoice.paid": {
        const subscriptionId = eventData.subscription as string | null;
        if (subscriptionId) {
          // Monthly credit grant for subscription
          await ctx.runMutation(internal.credits.internal.grantMonthlyCredits, {
            stripeSubscriptionId: subscriptionId,
            stripeInvoiceId: eventData.id as string, // Should be the invoice ID
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const subscriptionId = eventData.subscription as string | null;
        if (subscriptionId) {
          await ctx.runMutation(
            internal.subscriptions.internal.handlePaymentFailed,
            {
              stripeSubscriptionId: subscriptionId,
            }
          );
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${eventType}`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);
    return new Response("Processing error", { status: 500 });
  }
});

function mapStripeStatus(
  status: string
): "active" | "past_due" | "canceled" | "trialing" {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    case "trialing":
      return "trialing";
    default:
      return "active";
  }
}
