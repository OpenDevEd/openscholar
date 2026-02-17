export type StripeEventLogStatus =
  | "received"
  | "processed"
  | "retrying"
  | "failed"
  | "ignored";

export function shouldSkipProcessedTransition(args: {
  status?: StripeEventLogStatus;
  nextRetryAt?: number;
  now: number;
}): boolean {
  if (args.status === "ignored" || args.status === "failed") {
    return true;
  }

  if (
    args.status === "retrying" &&
    typeof args.nextRetryAt === "number" &&
    args.nextRetryAt > args.now
  ) {
    return true;
  }

  return false;
}
