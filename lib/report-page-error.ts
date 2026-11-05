"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * For an error page. React stops an error it catches from reaching the browser's error handlers, where
 * PostHog listens, so the page sends it. PostHog is the outside system. `before_send` still drops the
 * report for anyone who hasn't accepted analytics (instrumentation-client.ts).
 */
export function useReportPageError(page: string, error: Error & { digest?: string }) {
  useEffect(() => {
    console.error(`[${page}]`, error);
    if (posthog.__loaded) posthog.captureException(error, { error_page: page, digest: error.digest });
  }, [page, error]);
}
