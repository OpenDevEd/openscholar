/**
 * Google Analytics on both sites, only once someone accepts, with advertising off as the privacy policy says. The
 * property's own settings keep search text away from Google: Site search is off, and the query parameters that carry
 * typed text are redacted. No framework imports: the marketing site uses this file too.
 */
export const GA_CONSENT_DEFAULTS = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" };
export const GA_CONFIG = { allow_google_signals: false, allow_ad_personalization_signals: false };

/** A withdrawn consent stops the tag that's already loaded and removes its cookies, which sit on a parent domain. */
export function setGoogleAnalyticsAllowed(id: string, allowed: boolean) {
  (window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = !allowed;
  if (allowed) return;
  const domains = window.location.hostname.split(".").map((_, i, parts) => parts.slice(i).join("."));
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (!/^_ga(_|$)/.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=.${domain}`;
  }
}

/** The tag, for a page without Next.js. The app loads the same settings through next/script. */
export function loadGoogleAnalytics(id: string) {
  setGoogleAnalyticsAllowed(id, true);
  if (document.getElementById("google-analytics")) return;
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // gtag reads the arguments object itself, not an array.
    w.dataLayer.push(arguments);
  };
  w.gtag("consent", "default", GA_CONSENT_DEFAULTS);
  w.gtag("js", new Date());
  w.gtag("config", id, GA_CONFIG);
  const script = document.createElement("script");
  script.id = "google-analytics";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(script);
}
