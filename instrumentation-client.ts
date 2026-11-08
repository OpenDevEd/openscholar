import posthog from "posthog-js";
import { applyConsentToPostHog, CONSENT_UPDATED_EVENT, watchConsent } from "@/lib/consent-cookie";
import { postHogOptions, sendsAnalytics } from "@/lib/posthog-options";

if (process.env.NEXT_PUBLIC_POSTHOG_KEY && sendsAnalytics(window.location.hostname)) {
  posthog.init(
    process.env.NEXT_PUBLIC_POSTHOG_KEY,
    postHogOptions({ apiHost: "/data", uiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST, debug: process.env.NODE_ENV === "development" }),
  );
  // An answer given on openscholar.ai holds here too, including one given in another tab while this one was open.
  // The event tells Google Analytics and the identify step (useAnalyticsConsent) to follow.
  applyConsentToPostHog(posthog);
  watchConsent((choice) => {
    applyConsentToPostHog(posthog, choice, true);
    window.dispatchEvent(new CustomEvent(CONSENT_UPDATED_EVENT));
  });
}
