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
