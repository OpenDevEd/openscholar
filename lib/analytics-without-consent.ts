import type { CaptureResult } from "posthog-js";

/**
 * Clicks keep the words on what was clicked, which can be a name or an email. Errors and timings can hold addresses
 * and typed text. Leaving a page says only how long someone stayed and how far they scrolled.
 */
const NEEDS_CONSENT = new Set([
  "$autocapture", "$copy_autocapture", "$rageclick", "$dead_click", "$$heatmap",
  "$exception", "$web_vitals", "$identify", "$set", "$pageleave",
]);
/** Read from the device, or leading to someone's work. What a browser sends with any request, such as its type, can stay. */
const REMOVED = new Set([
  "$screen_height", "$screen_width", "$viewport_height", "$viewport_width",
  "$timezone", "$timezone_offset", "$browser_language", "$browser_language_prefix",
  "$ai_session_id", "$ai_trace_id", "credits_remaining",
  // One time for the whole page load, and the page before's ID: either ties a visitor's pages together.
  "$initialization_time", "$prev_pageview_id",
]);
/** The time spent and the scrolling on the page before, which a page view carries. Its address stays, without IDs. */
const PREVIOUS_PAGE_READINGS = /^\$prev_pageview_(duration|(last|max)_(scroll|content))/;
const ADDRESSES = ["$current_url", "$pathname", "$prev_pageview_pathname", "$referrer"];
/** PostHog needs these to accept the event. Any other text or list an event carries may be what someone typed. */
const REQUIRED = new Set(["token", "distinct_id"]);
/** Route segments that name an account, an organization or their work, whatever they look like. */
const PRIVATE_SEGMENT = /(\/(?:o|join|shared|results|extraction|from-library|evidence-communities)\/)[^/]+/g;

/** An address without its query, and with each name and long ID out of its path: they can lead back to an account or organization. */
const withoutIds = (address: string) => {
  const [, site = "", path] = /^(\w+:\/\/[^/?#]+)?([^?#]*)/.exec(address) ?? [];
  return site + path.replace(PRIVATE_SEGMENT, "$1:id").replace(/[^/]*\d[^/]*/g, (part) => (part.length >= 16 ? ":id" : part));
};

/**
 * Someone who hasn't accepted analytics, or has rejected it, is only counted: which page, from where, in
 * what kind of browser, and which named actions. Nothing links the count to them. See the cookie policy.
 */
export function reduceWithoutConsent(event: CaptureResult): CaptureResult | null {
  const properties = event.properties;
  if (!properties.$cookieless_mode) return event;
  if (NEEDS_CONSENT.has(event.event)) return null;
  for (const [key, value] of Object.entries(properties)) {
    const mayBeTyped = !key.startsWith("$") && !REQUIRED.has(key) && typeof value !== "number" && typeof value !== "boolean";
    if (mayBeTyped || REMOVED.has(key) || PREVIOUS_PAGE_READINGS.test(key)) delete properties[key];
  }
  for (const key of ADDRESSES) {
    if (typeof properties[key] === "string") properties[key] = withoutIds(properties[key]);
  }
  delete event.$set;
  delete event.$set_once;
  return event;
}
