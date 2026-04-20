"use client";

/**
 * Plan-06 thin wrapper around <JobStatusBanner variant="creditsExhausted">.
 *
 * Kept as an alias so existing call sites (job detail page, tests) don't
 * need to be rewritten. New code should import JobStatusBanner directly.
 */

import { JobStatusBanner } from "./job-status-banner";

export interface CreditsExhaustedBannerProps {
  /**
   * Minimum credits required before the Resume button may re-enable.
   * Plan-03 ships this as 1 (just enough to start a single question);
   * plan-04's credit-aggregation surfaces a "remaining estimate" that
   * will replace this.
   */
  minCreditsToResume?: number;
  onResume?: () => void;
  onCancelRemaining?: () => void;
}

export function CreditsExhaustedBanner(props: CreditsExhaustedBannerProps) {
  return <JobStatusBanner variant="creditsExhausted" {...props} />;
}
