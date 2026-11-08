import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { reduceWithoutConsent } from "@/lib/analytics-without-consent";

const event = (name: string, properties: Record<string, unknown>) =>
  ({ uuid: "1", event: name, properties, $set: { email: "a@b.org" } }) as unknown as CaptureResult;

describe("analytics without consent", () => {
  it("leaves an event from someone who accepted alone", () => {
    const accepted = event("$autocapture", { $el_text: "a@b.org", query: "cannabis" });
    expect(reduceWithoutConsent(accepted)).toBe(accepted);
  });

  it("sends no click, which can carry a name or an email", () => {
    expect(reduceWithoutConsent(event("$autocapture", { $cookieless_mode: true, $el_text: "a@b.org" }))).toBeNull();
  });

  it("sends no page leave, which only says how long someone stayed and how far they scrolled", () => {
    expect(reduceWithoutConsent(event("$pageleave", { $cookieless_mode: true, $prev_pageview_duration: 29 }))).toBeNull();
  });

  it("keeps a page view without the time and scrolling on the page before, or what links the two", () => {
    const reduced = reduceWithoutConsent(
      event("$pageview", {
        $cookieless_mode: true,
        $pathname: "/privacy",
        $initialization_time: "2026-11-05T07:20:37.673Z",
        $prev_pageview_id: "01a1aa94",
        $prev_pageview_pathname: "/",
        $prev_pageview_duration: 29.094,
        $prev_pageview_last_scroll: 12372,
        $prev_pageview_last_scroll_percentage: 1,
        $prev_pageview_max_scroll: 12372,
        $prev_pageview_max_scroll_percentage: 1,
        $prev_pageview_last_content: 13216,
        $prev_pageview_last_content_percentage: 1,
        $prev_pageview_max_content: 13216,
        $prev_pageview_max_content_percentage: 1,
      }),
    );
    expect(reduced?.properties).toEqual({ $cookieless_mode: true, $pathname: "/privacy", $prev_pageview_pathname: "/" });
  });

  it("keeps the count and removes typed text, device readings and account links", () => {
    const reduced = reduceWithoutConsent(
      event("search_executed", {
        $cookieless_mode: true,
        token: "phc_1",
        distinct_id: "$posthog_cookieless",
        $raw_user_agent: "Mozilla",
        $host: "discover.openscholar.ai",
        $browser: "Firefox",
        $screen_width: 1280,
        $timezone: "Europe/London",
        query: "cannabis depression",
        screening_questions: ["Is this about cannabis?"],
        results_count: 12,
        $current_url: "https://discover.openscholar.ai/results/826a7942-b855-4244-a8cd-2c2808cda5d9?q=cannabis",
        $pathname: "/o/open-development-and-education/library",
        $referrer: "$direct",
      }),
    );
    expect(reduced?.$set).toBeUndefined();
    expect(reduced?.properties).toEqual({
      $cookieless_mode: true,
      token: "phc_1",
      distinct_id: "$posthog_cookieless",
      $raw_user_agent: "Mozilla",
      $host: "discover.openscholar.ai",
      $browser: "Firefox",
      results_count: 12,
      $current_url: "https://discover.openscholar.ai/results/:id",
      $pathname: "/o/:id/library",
      $referrer: "$direct",
    });
  });
});

describe("analytics without consent, names from a fixed list", () => {
  it("keeps where a click was and the campaign, and drops text that only sits in the same field", () => {
    const reduced = reduceWithoutConsent(
      event("cta_clicked", {
        $cookieless_mode: true,
        placement: "hero",
        target: "get_started",
        utm_source: "newsletter",
        utm_campaign: "launch-2026",
        topic: "a@b.org is my email",
        query: "hero",
      }),
    );
    expect(reduced?.properties).toEqual({
      $cookieless_mode: true,
      placement: "hero",
      target: "get_started",
      utm_source: "newsletter",
      utm_campaign: "launch-2026",
    });
  });
});
