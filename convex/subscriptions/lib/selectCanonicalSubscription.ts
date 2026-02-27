import type { Doc } from "../../_generated/dataModel";

type Subscription = Doc<"subscriptions">;

/**
 * Selects a deterministic "best" subscription from a list already ordered by recency.
 *
 * After SUB-03 fix: canceled records now retain stripeSubscriptionId and have plan: "free".
 * This function still correctly prioritizes non-canceled records over canceled ones.
 * A user who cancels and re-subscribes will have both a canceled record (with old Stripe ID)
 * and a new active record (with new Stripe ID) -- the active record wins at step 1.
 *
 * Priority order:
 * 1. Non-canceled paid with Stripe ID (active subscription)
 * 2. Non-canceled paid (paid but missing Stripe ID edge case)
 * 3. Non-canceled free (active free plan)
 * 4. Any free (includes canceled records with plan: "free" post-SUB-03)
 * 5. Any with Stripe ID (canceled records with preserved Stripe ID)
 * 6. First record (fallback)
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
