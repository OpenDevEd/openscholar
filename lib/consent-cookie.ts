/**
 * The analytics answer, shared by openscholar.ai (the marketing site) and the app on discover.openscholar.ai. A
 * cookie on the parent domain is the one store both read, so a choice on either site holds on both. Kept with its
 * time and policy version for the record. No framework imports: the marketing site uses this file too.
 */
import type { PostHog } from "posthog-js";

export type ConsentChoice = "granted" | "denied";

export interface ConsentRecord {
  choice: ConsentChoice;
  timestamp: string;
  policyVersion: string;
}

export const CONSENT_COOKIE = "openscholar_consent";
const POLICY_VERSION = "1.0";
const YEAR = 60 * 60 * 24 * 365;
/** Where the app kept the answer before the cookie. Read once, moved into the cookie, then removed. */
const LOCAL_STORAGE_KEY = "openscholar_cookie_consent";
export const CONSENT_UPDATED_EVENT = "openscholar-consent-updated";

/** openscholar.ai and every site under it share the answer. Anywhere else, such as a local copy, it stays on its own host. */
export function consentCookieDomain(hostname: string): string | undefined {
  return hostname === "openscholar.ai" || hostname.endsWith(".openscholar.ai") ? "openscholar.ai" : undefined;
}

function parse(value: string | undefined): ConsentRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(decodeURIComponent(value)) as ConsentRecord;
    return record.choice === "granted" || record.choice === "denied" ? record : null;
  } catch {
    return null;
  }
}

function save(record: ConsentRecord) {
  const domain = consentCookieDomain(location.hostname);
  document.cookie = [
    `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(record))}`,
    "path=/",
    `max-age=${YEAR}`,
    "samesite=lax",
    ...(domain ? [`domain=${domain}`] : []),
    ...(location.protocol === "https:" ? ["secure"] : []),
  ].join("; ");
}

export function readConsent(): ConsentRecord | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie.split("; ").find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const record = parse(cookie?.slice(CONSENT_COOKIE.length + 1));
  if (record) return record;
  try {
    const stored = parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? undefined);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    if (stored) save({ choice: stored.choice, timestamp: stored.timestamp, policyVersion: stored.policyVersion });
    return stored;
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice): ConsentRecord {
  const record = { choice, timestamp: new Date().toISOString(), policyVersion: POLICY_VERSION };
  save(record);
  window.dispatchEvent(new CustomEvent(CONSENT_UPDATED_EVENT));
  return record;
}

/**
 * PostHog keeps its own record of the answer, so each site hands it the shared one when it starts. After a change in
 * another tab its record already reads the new answer while it still runs the old way: `always` makes it switch.
 */
export function applyConsentToPostHog(posthog: PostHog, choice = readConsent()?.choice, always = false) {
  const status = posthog.get_explicit_consent_status();
  if (choice === "granted" && (always || status !== "granted")) posthog.opt_in_capturing();
  if (choice === "denied" && (always || status !== "denied")) posthog.opt_out_capturing();
}

/**
 * The answer can change on the other site in another tab or window. Each site reads it again when it comes back into
 * view or focus, or as soon as the cookie changes where the browser reports that, and calls back if it changed, so a
 * rejection on one site stops the other.
 */
export function watchConsent(onChange: (choice: ConsentChoice | undefined) => void) {
  let last = readConsent()?.choice;
  // An answer given in this tab moves the baseline too, so a later change elsewhere is still seen.
  window.addEventListener(CONSENT_UPDATED_EVENT, () => {
    last = readConsent()?.choice;
  });
  const check = () => {
    const now = readConsent()?.choice;
    if (now === last) return;
    last = now;
    onChange(now);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("focus", check);
  (window as Window & { cookieStore?: EventTarget }).cookieStore?.addEventListener("change", check);
}
