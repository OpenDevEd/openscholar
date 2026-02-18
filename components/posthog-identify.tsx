"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";

/**
 * Syncs PostHog distinct_id with the authenticated user's workosId.
 * Call posthog.identify(workosId) when user loads, posthog.reset() on logout.
 */
export function PostHogIdentify() {
  const user = useQuery(api.users.queries.me);
  const lastIdentifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      if (lastIdentifiedRef.current !== user.workosId) {
        posthog.identify(user.workosId);
        lastIdentifiedRef.current = user.workosId;
      }
    } else if (lastIdentifiedRef.current !== null) {
      posthog.reset();
      lastIdentifiedRef.current = null;
    }
  }, [user]);

  return null;
}
