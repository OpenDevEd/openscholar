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

export type ClerkEventMetadata = {
  instanceId: string;
  eventId: string;
  eventType: string;
  entityType: "user" | "organization" | "organizationMembership";
  entityId: string;
  occurredAt: number;
  payloadSha256: string;
  processedAt: number;
};

export async function applyOrderedClerkEvent(
  ctx: MutationCtx,
  metadata: ClerkEventMetadata,
  apply: () => Promise<void>,
): Promise<ClerkEventOutcome> {
  const existing = await ctx.db
    .query("clerkEventLogs")
    .withIndex("by_instanceId_and_eventId", (query) =>
      query
        .eq("instanceId", metadata.instanceId)
        .eq("eventId", metadata.eventId),
    )
    .unique();
  const latestApplied = await ctx.db
    .query("clerkEventLogs")
    .withIndex("by_entity_outcome_time", (query) =>
      query
        .eq("instanceId", metadata.instanceId)
        .eq("entityType", metadata.entityType)
        .eq("entityId", metadata.entityId)
        .eq("outcome", "applied"),
    )
    .order("desc")
    .first();
  const outcome = classifyClerkEvent({
    eventId: metadata.eventId,
    occurredAt: metadata.occurredAt,
    existing,
    latestApplied,
  });

  if (outcome === "duplicate") {
    return outcome;
  }
  if (outcome === "applied") {
    await apply();
  }
  await ctx.db.insert("clerkEventLogs", {
    instanceId: metadata.instanceId,
    eventId: metadata.eventId,
    eventType: metadata.eventType,
    entityType: metadata.entityType,
    entityId: metadata.entityId,
    occurredAt: metadata.occurredAt,
    payloadSha256: metadata.payloadSha256,
    outcome,
    processedAt: metadata.processedAt,
  });
  return outcome;
}
import type { MutationCtx } from "../_generated/server";
