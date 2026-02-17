export function isSubscriptionScheduledToCancel(args: {
  cancelAtPeriodEnd?: boolean | null;
  cancelAt?: number | null;
  currentPeriodEnd?: number | null;
  nowUnixSeconds?: number;
}): boolean {
  if (args.cancelAtPeriodEnd === true) return true;

  if (typeof args.cancelAt !== "number") return false;

  const now = args.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  if (args.cancelAt <= now) return false;

  // Stripe commonly sets cancel_at ~= current_period_end for period-end cancellation.
  // Treat any future cancel_at as scheduled cancellation in UI, and keep
  // tolerance logic for explicit period-end semantics.
  if (typeof args.currentPeriodEnd === "number" && args.currentPeriodEnd > 0) {
    const toleranceSeconds = 5 * 60;
    if (Math.abs(args.cancelAt - args.currentPeriodEnd) <= toleranceSeconds) {
      return true;
    }
  }

  return true;
}
