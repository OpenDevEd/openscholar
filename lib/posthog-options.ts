/**
 * How PostHog starts on both sites: the app (instrumentation-client.ts) and the marketing site
 * (marketing/src/scripts/analytics.ts). No framework imports, since the marketing site bundles this file too.
 */
import type { PostHogConfig } from "posthog-js";
import { reduceWithoutConsent } from "./analytics-without-consent";

/** Session replays show no text inside an element with this attribute. */
const REPLAY_MASK_ATTRIBUTE = "data-ph-mask";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const stars = (value: string) => "*".repeat(value.length);
const hideEmails = (value: string) => value.replace(EMAIL, stars);
/** Attributes that carry what a page says or links to: words a person reads or hears, and addresses. */
const CONTENT_ATTRIBUTES = new Set([
  "aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder", "value", "data-value",
  "href", "src", "srcset", "action", "formaction", "poster", "cite", "download",
]);
const masked = (element?: Element) => Boolean(element?.closest(`[${REPLAY_MASK_ATTRIBUTE}]`));

/** A local dev server sends nothing: its traffic isn't the product's. A `*.localhost` host still sends, for testing. */
export const sendsAnalytics = (hostname: string) => !/^(localhost|127\.0\.0\.1)$/.test(hostname);

export function postHogOptions({ apiHost, uiHost, debug = false }: { apiHost: string; uiHost?: string; debug?: boolean }): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    ui_host: uiHost,
    defaults: "2026-08-30",
    // No cookies until someone accepts. Until then, and after a rejection, a reduced count with a daily hash.
    cookieless_mode: "on_reject",
    opt_out_capturing_by_default: true,
    capture_exceptions: true,
    debug,
    person_profiles: "always",
    capture_heatmaps: true,
    // Every event names the site it came from, as the server's do (convex/lib/analytics.ts). Set here, not
    // with register(), whose properties don't survive the switch to cookies when someone accepts them.
    before_send: (event) => {
      const kept = event && reduceWithoutConsent(event);
      if (kept) kept.properties.environment = window.location.host;
      return kept;
    },
    session_recording: {
      // Replays show no email address anywhere, as text or in an attribute such as a mailto link, and no
      // words or links at all where the page marks it (settings, the assistant), in its text or its attributes.
      maskTextSelector: "*",
      maskTextFn: (text, element) => (masked(element) ? stars(text) : hideEmails(text)),
      maskAttributeFn: (name, value, element) => (masked(element) && CONTENT_ATTRIBUTES.has(name) ? stars(value) : hideEmails(value)),
    },
  };
}
