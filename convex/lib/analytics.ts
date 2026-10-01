"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  captureAIGenerationBatchServer,
  captureAIGenerationServer,
  captureServerEvent,
  type ServerAIGenerationParams,
} from "../../lib/posthog-server";
import type { AITrackingEntry } from "../../lib/posthog-ai-shared";
import type { AIProvider } from "../../lib/types/ai.types";

/**
 * Fire-and-forget PostHog event capture from Convex mutations.
 * Schedule via `ctx.scheduler.runAfter(0, internal.lib.analytics.captureEvent, {...})`.
 */
export const captureEvent = internalAction({
  args: {
    distinctId: v.string(),
    event: v.string(),
    properties: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await captureServerEvent(
      args.distinctId,
      args.event,
      (args.properties as Record<string, unknown>) ?? {},
    );
    return null;
  },
});

/**
 * Sends `$ai_generation` events after the work that made them, so AI work
 * doesn't wait on PostHog. Schedule via `ctx.scheduler.runAfter(0, ...)`.
 */
export const captureAIGeneration = internalAction({
  args: { params: v.any() },
  returns: v.null(),
  handler: async (_ctx, { params }) => {
    await captureAIGenerationServer(params as ServerAIGenerationParams);
    return null;
  },
});

export const captureAIGenerationBatch = internalAction({
  args: { distinctId: v.string(), provider: v.string(), modelId: v.string(), entries: v.array(v.any()) },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await captureAIGenerationBatchServer(args.distinctId, args.provider as AIProvider, args.modelId, args.entries as AITrackingEntry[]);
    return null;
  },
});
