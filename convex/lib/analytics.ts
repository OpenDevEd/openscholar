"use node";

import { PostHog } from "posthog-node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { analyticsEventValidator, UNNAMED_ACCOUNT, withoutAccount } from "./analyticsEvents";
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
 * names the site it came from in `environment`, as the browser's events do, and
 * the person only if they've accepted analytics.
 */
export const capture = internalAction({
  args: { events: v.array(analyticsEventValidator) },
  returns: v.null(),
  handler: async (ctx, { events }) => {
    const key = process.env.POSTHOG_KEY;
    if (!key) return null;
    // OpenScholar's project is in PostHog's EU region, where the browser's /data proxy sends too (next.config.ts).
    const client = new PostHog(key, { host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com" });
    client.on("error", (error) => console.error("[analytics] PostHog refused events", error));
    const environment = site();
    const accepted = new Set(
      await ctx.runQuery(internal.users.internal.acceptedAnalytics, { clerkIds: [...new Set(events.map((event) => event.distinctId))] }),
    );
    for (const { distinctId, event, properties, timestamp } of events) {
      const named = accepted.has(distinctId);
      client.capture({
        distinctId: named ? distinctId : UNNAMED_ACCOUNT,
        event,
        properties: { ...(named ? JSON.parse(properties) : withoutAccount(JSON.parse(properties))), environment },
        timestamp: new Date(timestamp),
      });
    }
    await client.shutdown();
    return null;
  },
});
