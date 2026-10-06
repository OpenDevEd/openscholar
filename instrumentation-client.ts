import posthog from "posthog-js";

/** Session replays show no text inside an element with this attribute. */
const REPLAY_MASK_ATTRIBUTE = "data-ph-mask";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const stars = (value: string) => "*".repeat(value.length);
const hideEmails = (value: string) => value.replace(EMAIL, stars);
/** Attributes that carry words a person reads or hears, as text does. */
const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder", "value", "data-value"]);
const masked = (element?: Element) => Boolean(element?.closest(`[${REPLAY_MASK_ATTRIBUTE}]`));

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
    // Every event names the site it came from, as the server's do (convex/lib/analytics.ts). Set here, not
    // with register(), whose properties don't survive the switch to cookies when someone accepts them.
    before_send: (event) => {
      if (event) event.properties.environment = window.location.host;
      return event;
    },
    session_recording: {
      // Replays show no email address anywhere, as text or in an attribute such as a mailto link, and no
      // words at all where the page marks it (settings, the assistant), in its text or its labels.
      maskTextSelector: "*",
      maskTextFn: (text, element) => (masked(element) ? stars(text) : hideEmails(text)),
      maskAttributeFn: (name, value, element) => (masked(element) && TEXT_ATTRIBUTES.has(name) ? stars(value) : hideEmails(value)),
    },
  });
}
