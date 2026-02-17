export type SubscriptionPlan = "free" | "go" | "pro" | "enterprise";

export const ENTITLED_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;

export const NON_ENTITLED_SUBSCRIPTION_STATUSES = [
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;

export const ALL_SUBSCRIPTION_STATUSES = [
  ...ENTITLED_SUBSCRIPTION_STATUSES,
  ...NON_ENTITLED_SUBSCRIPTION_STATUSES,
] as const;

export type SubscriptionStatus = (typeof ALL_SUBSCRIPTION_STATUSES)[number];

export type SubscriptionLike =
  | {
      plan: SubscriptionPlan;
      status: SubscriptionStatus | string;
    }
  | null
  | undefined;

const ENTITLED_STATUS_SET = new Set<string>(ENTITLED_SUBSCRIPTION_STATUSES);

export function isEntitledStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ENTITLED_STATUS_SET.has(status);
}

export function isEntitledSubscription(subscription: SubscriptionLike): boolean {
  if (!subscription) return false;
  return isEntitledStatus(subscription.status);
}

export function resolveEffectivePlan(subscription: SubscriptionLike): SubscriptionPlan {
  if (!subscription) return "free";
  return isEntitledStatus(subscription.status) ? subscription.plan : "free";
}
