import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import {
  buildAIGenerationProperties,
  type AIGenerationParams,
  type AITrackingEntry,
  type ServerAIGenerationParams,
} from "../../lib/posthog-ai-shared";
import type { AIProvider } from "../../lib/types/ai.types";

export const analyticsEventValidator = v.object({
  distinctId: v.string(),
  event: v.string(),
  /** JSON: PostHog's own property names start with `$`, which a Convex value can't hold. */
  properties: v.string(),
  /** When it happened. It's sent after, and PostHog would otherwise date it then. */
  timestamp: v.number(),
});
export type AnalyticsEvent = Omit<Infer<typeof analyticsEventValidator>, "properties"> & { properties: Record<string, unknown> };

/** Schedules PostHog events (./analytics.ts). Analytics never fails the work it describes. */
export async function captureLater(
  ctx: Pick<ActionCtx | MutationCtx, "scheduler">,
  events: AnalyticsEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await ctx.scheduler
    .runAfter(0, internal.lib.analytics.capture, {
      events: events.map((event) => ({ ...event, properties: JSON.stringify(event.properties) })),
    })
    .catch((error) => console.error("[analytics] scheduling events failed", { events: events.length, error }));
}

/** Schedules one `$ai_generation` event. */
export async function captureGenerationLater(ctx: Pick<ActionCtx, "scheduler">, { distinctId, ...params }: ServerAIGenerationParams) {
  await captureLater(ctx, [
    { distinctId, event: "$ai_generation", properties: buildAIGenerationProperties(params), timestamp: Date.now() },
  ]);
}

/** Schedules a `$ai_generation` for work run as `userId`, whom PostHog knows by their Clerk ID. */
export async function captureUserGenerationLater(ctx: Pick<ActionCtx, "scheduler" | "runQuery">, userId: Id<"users">, params: AIGenerationParams) {
  const user = await ctx.runQuery(internal.users.internal.getUserById, { userId }).catch(() => null);
  if (user?.clerkId) await captureGenerationLater(ctx, { distinctId: user.clerkId, ...params });
}

/** Schedules a batch's `$ai_generation` events, one per item, under one trace. */
export async function captureGenerationsLater(
  ctx: Pick<ActionCtx, "scheduler">,
  { distinctId, provider, modelId, entries }: { distinctId: string; provider: AIProvider; modelId: string; entries: AITrackingEntry[] },
) {
  const traceId = crypto.randomUUID();
  const timestamp = Date.now();
  await captureLater(
    ctx,
    entries.map((entry) => ({
      distinctId,
      event: "$ai_generation",
      properties: buildAIGenerationProperties({ provider, modelId, traceId, ...entry }),
      timestamp,
    })),
  );
}
