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

  const nonCanceled = subscriptions.filter(
    (subscription) => subscription.status !== "canceled",
  );
  const activePaidWithStripe = nonCanceled.find(
    (subscription) =>
      subscription.plan !== "free" && Boolean(subscription.stripeSubscriptionId),
  );
  if (activePaidWithStripe) {
    return activePaidWithStripe;
  }

  const activePaid = nonCanceled.find((subscription) => subscription.plan !== "free");
  if (activePaid) {
    return activePaid;
  }

  const activeFree = nonCanceled.find((subscription) => subscription.plan === "free");
  if (activeFree) {
    return activeFree;
  }

  const anyFree = subscriptions.find((subscription) => subscription.plan === "free");
  if (anyFree) {
    return anyFree;
  }

  const anyPaidWithStripe = subscriptions.find((subscription) =>
    Boolean(subscription.stripeSubscriptionId),
  );
  if (anyPaidWithStripe) {
    return anyPaidWithStripe;
  }

  return subscriptions[0] ?? null;
}
