import { describe, expect, it } from "vitest";
import { clerkLocalizationFor } from "../lib/auth/clerk-localization";
import { locales } from "../i18n/config";
import {
  resolveClerkAppearance,
} from "../lib/auth/clerk-ui-config";

describe("clerk ui config", () => {
  it("has Clerk's screens for every language the site offers", async () => {
    await expect(clerkLocalizationFor("en-US")).resolves.toBeUndefined();
    for (const locale of locales.filter((code) => code !== "en-US")) {
      const localization = await clerkLocalizationFor(locale);
      expect(localization?.userProfile?.start?.emailAddressesSection?.title, locale).toBeTruthy();
    }
  });

  it("returns dark appearance only for dark mode", () => {
    expect(resolveClerkAppearance("dark").theme).toBeDefined();
    expect(resolveClerkAppearance("light").theme).toBeUndefined();
    expect(resolveClerkAppearance(undefined).theme).toBeUndefined();
  });
});
