"use node";

import { PostHog } from "posthog-node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { analyticsEventValidator } from "./analyticsEvents";
import { requireAppUrl } from "./env";

/** The site these events came from, or none where the deployment doesn't say: analytics never fails. */
function site() {
  try {
    return new URL(requireAppUrl()).host;
  } catch {
    return undefined;
  }
}

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
    // OpenScholar's project is in PostHog's EU region, where the browser's /data proxy sends too (next.config.ts).
    const client = new PostHog(key, { host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com" });
    client.on("error", (error) => console.error("[analytics] PostHog refused events", error));
    const environment = site();
    for (const { distinctId, event, properties, timestamp } of events) {
      client.capture({ distinctId, event, properties: { ...JSON.parse(properties), environment }, timestamp: new Date(timestamp) });
    }
    await client.shutdown();
    return null;
  },
});
