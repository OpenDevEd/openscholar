import posthog from "posthog-js";

console.log(process.env.NEXT_PUBLIC_POSTHOG_KEY);
console.log(process.env.NEXT_PUBLIC_POSTHOG_HOST);
console.log(process.env.NODE_ENV);

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: "/data",
  ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  // Include the defaults option as required by PostHog
  defaults: "2026-01-30",
  // Enables capturing unhandled exceptions via Error Tracking
  capture_exceptions: true,
  // Turn on debug in development mode
  debug: process.env.NODE_ENV === "development",
  person_profiles: "always",
  capture_heatmaps: true,
});
