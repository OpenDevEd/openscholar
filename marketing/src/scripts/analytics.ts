// Analytics for openscholar.ai, set up as on discover.openscholar.ai and sharing its answer to the cookie banner
// (lib/consent-cookie.ts), so someone who accepts is one person from this page to signing up in the app. Until
// someone accepts, PostHog only counts, as on the app (lib/analytics-without-consent.ts).
import posthog, { type Properties } from "posthog-js";
import { applyConsentToPostHog, readConsent, watchConsent, writeConsent, type ConsentChoice } from "../../../lib/consent-cookie";
import { loadGoogleAnalytics, setGoogleAnalyticsAllowed } from "../../../lib/google-analytics-tag";
import { postHogOptions, sendsAnalytics } from "../../../lib/posthog-options";

const root = document.documentElement;
const panel = document.querySelector<HTMLElement>("[data-consent]")!;
const { app = "", posthogKey, gaId } = panel.dataset;
const communities: Record<string, string> = JSON.parse(panel.dataset.communities ?? "{}");
const on = sendsAnalytics(location.hostname);

const setGoogle = (choice: ConsentChoice | undefined) => {
  if (!on || !gaId) return;
  if (choice === "granted") loadGoogleAnalytics(gaId);
  else setGoogleAnalyticsAllowed(gaId, false);
};

// Events go through the app's own proxy, so they reach PostHog from a first-party address.
const start = () => {
  if (on && posthogKey) {
    posthog.init(posthogKey, postHogOptions({ apiHost: `${app}/data`, uiHost: "https://eu.posthog.com" }));
    applyConsentToPostHog(posthog);
  }
  if (readConsent()?.choice === "granted") setGoogle("granted");
};
// A page the browser prerenders for a hover isn't a visit until it's opened.
if ((document as Document & { prerendering?: boolean }).prerendering) document.addEventListener("prerenderingchange", start, { once: true });
else start();

// An answer changed on the app in another tab holds here as soon as this tab is back.
watchConsent((choice) => {
  if (posthog.__loaded) applyConsentToPostHog(posthog, choice, true);
  setGoogle(choice);
  root.classList.toggle("ask", !choice);
});

// A click that leaves the page still sends: the event goes at once, by beacon.
const track = (event: string, properties: Properties) => {
  if (posthog.__loaded) posthog.capture(event, properties, { send_instantly: true, transport: "sendBeacon" });
};

const choose = (choice: ConsentChoice) => {
  writeConsent(choice);
  if (posthog.__loaded) applyConsentToPostHog(posthog, choice);
  setGoogle(choice);
  root.classList.remove("ask");
};

/** Where on the page something sits: the header, its menu, the footer, or the section it's in. */
const placementOf = (el: Element) => {
  if (el.closest(".mega, .sheet")) return "menu";
  if (el.closest(".top")) return "header";
  if (el.closest("footer")) return "footer";
  const section = el.closest<HTMLElement>("[data-placement], section");
  return section?.dataset.placement ?? (section?.id || [...(section?.classList ?? [])].find((c) => c !== "bleed" && c !== "panel")) ?? "page";
};

/** What a link leads to, for the links that leave this site or ask for contact. Moving around this site shows as page views. */
const targetOf = (url: URL): Properties | null => {
  if (url.origin === app) {
    if (url.pathname.startsWith("/sign-in")) return { target: "sign_in" };
    if (url.pathname === "/" || url.pathname.startsWith("/sign-up")) return { target: "get_started" };
    return null;
  }
  if (communities[url.hostname]) return { target: "community", community: communities[url.hostname] };
  if (url.origin === location.origin && url.pathname.startsWith("/contact")) return { target: "contact", topic: url.searchParams.get("topic") ?? undefined };
  if (url.protocol === "mailto:") return { target: "email" };
  return null;
};

document.addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target : null;
  const choice = el?.closest<HTMLElement>("[data-choice]")?.dataset.choice;
  if (choice === "granted" || choice === "denied") return choose(choice);
  if (el?.closest("[data-consent-open]")) return void root.classList.add("ask");
  const link = el?.closest("a");
  const target = link && targetOf(new URL(link.href, location.href));
  if (target) track("cta_clicked", { ...target, placement: placementOf(link) });
});

// Searches from this site: where the box was, and whether it ran a question it suggested or one typed in.
document.addEventListener("submit", (e) => {
  const form = e.target instanceof HTMLFormElement && e.target.matches("[data-ask]") ? e.target : null;
  if (!form) return;
  const asked = form.querySelector("input")!.value.trim(), suggested: string[] = JSON.parse(form.dataset.questions ?? "[]");
  track("ask_submitted", { placement: placementOf(form), suggested: !asked || suggested.includes(asked) });
});

// The contact form says when a message went (ContactBody.astro).
document.addEventListener("contact-sent", (e) => track("contact_sent", { topic: (e as CustomEvent<string>).detail }));

// How far down a page people get: each section in the header's rail, once, when its top reaches the middle of the
// screen or someone jumps past it. Read on scroll, since an observer can miss a section a jump skips entirely.
const sections = [...document.querySelectorAll<HTMLElement>("[data-to]")].flatMap((a) => document.getElementById(a.dataset.to!) ?? []);
if (sections.length) {
  const reached = new Set<HTMLElement>();
  let frame = 0;
  const check = () => {
    frame = 0;
    for (const section of sections) {
      if (reached.has(section) || section.getBoundingClientRect().top > innerHeight / 2) continue;
      reached.add(section);
      track("section_reached", { section: section.id });
    }
  };
  addEventListener("scroll", () => { frame ||= requestAnimationFrame(check); }, { passive: true });
}
