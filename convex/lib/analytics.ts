"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { captureServerEvent } from "../../lib/posthog-server";

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
