import type { Doc } from "../../_generated/dataModel";

type Subscription = Doc<"subscriptions">;

/**
 * Selects a deterministic "best" subscription from a list already ordered by recency.
 */
export function selectCanonicalSubscription(
  subscriptions: Subscription[],
): Subscription | null {
  if (subscriptions.length === 0) {
    return null;
  }

  const active = subscriptions.filter((subscription) => subscription.status !== "canceled");
  const activePaidWithStripe = active.find(
    (subscription) =>
      subscription.plan !== "free" && Boolean(subscription.stripeSubscriptionId),
  );
  if (activePaidWithStripe) {
    return activePaidWithStripe;
  }

  const activePaid = active.find((subscription) => subscription.plan !== "free");
  if (activePaid) {
    return activePaid;
  }

  const activeFree = active.find((subscription) => subscription.plan === "free");
  if (activeFree) {
    return activeFree;
  }

  return subscriptions[0] ?? null;
}
