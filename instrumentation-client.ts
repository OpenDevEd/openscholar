import posthog from "posthog-js";
import { applyConsentToPostHog } from "@/lib/consent-cookie";
import { postHogOptions, sendsAnalytics } from "@/lib/posthog-options";

if (process.env.NEXT_PUBLIC_POSTHOG_KEY && sendsAnalytics(window.location.hostname)) {
  posthog.init(
    process.env.NEXT_PUBLIC_POSTHOG_KEY,
    postHogOptions({ apiHost: "/data", uiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST, debug: process.env.NODE_ENV === "development" }),
  );
  // An answer given on openscholar.ai holds here too.
  applyConsentToPostHog(posthog);
}
