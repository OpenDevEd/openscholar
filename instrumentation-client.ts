import posthog from "posthog-js";

/** Session replays show no text inside an element with this attribute. */
const REPLAY_MASK_ATTRIBUTE = "data-ph-mask";
const EMAIL = /\S+@\S+\.\S+/g;

// A local dev server sends nothing: its traffic isn't the product's.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: "/data",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-08-30",
    // GDPR: No cookies until user consents; use privacy-preserving hash if denied
    cookieless_mode: "on_reject",
    opt_out_capturing_by_default: true,
    // Enables capturing unhandled exceptions via Error Tracking
    capture_exceptions: true,
    // Turn on debug in development mode
    debug: process.env.NODE_ENV === "development",
    person_profiles: "always",
    capture_heatmaps: true,
    session_recording: {
      // Replays show no email address anywhere, and no text at all where the page marks it (account, billing).
      maskTextSelector: "*",
      maskTextFn: (text, element) =>
        element?.closest(`[${REPLAY_MASK_ATTRIBUTE}]`) ? "*".repeat(text.length) : text.replace(EMAIL, (match) => "*".repeat(match.length)),
    },
  });
  // Every event names the site it came from, as the server's do (convex/lib/analytics.ts).
  posthog.register({ environment: window.location.host });
}
