import type { SubscriptionStatus } from "../../lib/validators";

export function normalizeStripeSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
    case "past_due":
    case "canceled":
    case "trialing":
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return status;
    default:
      console.warn(`[StripeWebhook] Unknown subscription status: ${status}. Falling back to incomplete.`);
      return "incomplete";
  }
}
