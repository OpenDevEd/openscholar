export const ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS = [
  "subscription_create",
  "subscription_cycle",
] as const;

const ELIGIBLE_REASON_SET = new Set<string>(ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS);

const NON_RECURRING_REASONS = new Set<string>([
  "subscription_update",
  "manual",
  "upcoming",
  "subscription_threshold",
  "automatic_pending_invoice_item_invoice",
  "quote_accept",
]);

export type MonthlyCreditGrantDecision =
  | "grant"
  | "ignore_non_recurring"
  | "ignore_config_drift"
  | "retry_with_reconcile";

export type MonthlyCreditGrantClassification =
  | "eligible_recurring_invoice"
  | "ignored_non_subscription_invoice"
  | "ignored_non_recurring_reason"
  | "config_drift_missing_billing_reason"
  | "config_drift_unexpected_billing_reason"
  | "retry_invoice_not_paid";

export type MonthlyCreditGrantDecisionResult = {
  decision: MonthlyCreditGrantDecision;
  classification: MonthlyCreditGrantClassification;
  reason: string;
};

export function isEligibleMonthlyCreditBillingReason(
  billingReason: string | null | undefined,
): boolean {
  if (!billingReason) return false;
  return ELIGIBLE_REASON_SET.has(billingReason);
}

export function classifyMonthlyCreditInvoice(args: {
  invoiceBillingReason?: string | null;
  invoiceStatus?: string | null;
  stripeSubscriptionId?: string | null;
  stripeApiVersion?: string | null;
}): MonthlyCreditGrantDecisionResult {
  if (!args.stripeSubscriptionId) {
    return {
      decision: "ignore_non_recurring",
      classification: "ignored_non_subscription_invoice",
      reason: "Invoice is not tied to a Stripe subscription",
    };
  }

  if (args.invoiceStatus && args.invoiceStatus !== "paid") {
    return {
      decision: "retry_with_reconcile",
      classification: "retry_invoice_not_paid",
      reason: `Invoice status is ${args.invoiceStatus}; waiting for paid status`,
    };
  }

  const billingReason = args.invoiceBillingReason ?? null;

  if (billingReason && ELIGIBLE_REASON_SET.has(billingReason)) {
    return {
      decision: "grant",
      classification: "eligible_recurring_invoice",
      reason: `Billing reason ${billingReason} is grant-eligible`,
    };
  }

  if (billingReason && NON_RECURRING_REASONS.has(billingReason)) {
    return {
      decision: "ignore_non_recurring",
      classification: "ignored_non_recurring_reason",
      reason: `Billing reason ${billingReason} is not recurring-cycle grant eligible`,
    };
  }

  if (!billingReason) {
    const apiVersionPart = args.stripeApiVersion
      ? ` (event.api_version=${args.stripeApiVersion})`
      : "";
    return {
      decision: "ignore_config_drift",
      classification: "config_drift_missing_billing_reason",
      reason: `Missing invoice.billing_reason for paid subscription invoice${apiVersionPart}`,
    };
  }

  return {
    decision: "ignore_config_drift",
    classification: "config_drift_unexpected_billing_reason",
    reason: `Unexpected invoice.billing_reason=${billingReason} for paid subscription invoice`,
  };
}
