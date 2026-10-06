"use node";

import { PostHog } from "posthog-node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { analyticsEventValidator } from "./analyticsEvents";

/**
 * Sends events to PostHog after the work that made them (./analyticsEvents.ts
 * schedules it), so the work never waits on PostHog.
 *
 * posthog-node gives each event an ID that its retries keep, and leaves GeoIP
 * off: these requests come from this server, not from the person. Every event
 * names the site it came from in `environment`, as the browser's events do.
 */
export const capture = internalAction({
  args: { events: v.array(analyticsEventValidator) },
  returns: v.null(),
  handler: async (_ctx, { events }) => {
    const key = process.env.POSTHOG_KEY;
    if (!key) return null;
    const client = new PostHog(key, { host: process.env.POSTHOG_HOST });
    client.on("error", (error) => console.error("[analytics] PostHog refused events", error));
    const site = process.env.NEXT_PUBLIC_APP_URL;
    const environment = site ? new URL(site).host : undefined;
    for (const { distinctId, event, properties, timestamp } of events) {
      client.capture({ distinctId, event, properties: { ...JSON.parse(properties), environment }, timestamp: new Date(timestamp) });
    }
    await client.shutdown();
    return null;
  },
});
