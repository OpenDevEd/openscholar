export type ClerkEventOutcome =
  | "applied"
  | "duplicate"
  | "stale"
  | "timestamp_conflict";

type EventIdentity = {
  eventId: string;
  occurredAt: number;
};

export function classifyClerkEvent(args: {
  eventId: string;
  occurredAt: number;
  existing: EventIdentity | null;
  latestApplied?: EventIdentity | null;
}): ClerkEventOutcome {
  if (args.existing) {
    return "duplicate";
  }
  if (!args.latestApplied || args.occurredAt > args.latestApplied.occurredAt) {
    return "applied";
  }
  if (args.occurredAt < args.latestApplied.occurredAt) {
    return "stale";
  }
  return "timestamp_conflict";
}
