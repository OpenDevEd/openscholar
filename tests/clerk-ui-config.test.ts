import { describe, expect, it } from "vitest";
import { clerkLocalizationFor } from "../lib/auth/clerk-localization";
import { locales } from "../i18n/config";
import {
  resolveClerkAppearance,
} from "../lib/auth/clerk-ui-config";

describe("clerk ui config", () => {
  it("has Clerk's screens for every language the site offers", async () => {
    for (const locale of locales.filter((code) => code !== "en-US")) {
      const localization = await clerkLocalizationFor(locale);
      expect(localization?.userProfile?.start?.emailAddressesSection?.title, locale).toBeTruthy();
    }
  });

  // In OAuth consent the slot holds the app asking for access, not this one, so it must never be filled in.
  it("leaves OAuth consent naming the app that asks", async () => {
    for (const locale of locales) {
      const { oauthConsent, oauthDeviceVerification } = await clerkLocalizationFor(locale);
      expect(JSON.stringify({ oauthConsent, oauthDeviceVerification }), locale).not.toContain("Openscholar");
    }
  });

  // Clerk's English has no entry for these, so a language file built from its keys loses them, and the server's English shows.
  it("has sign-in's errors in every language but English", async () => {
    for (const locale of locales.filter((code) => !code.startsWith("en"))) {
      const errors = (await clerkLocalizationFor(locale))?.unstable__errors;
      expect(errors?.form_identifier_not_found, locale).toBeTruthy();
      expect(errors?.form_code_incorrect, locale).toBeTruthy();
    }
  });

  it("returns dark appearance only for dark mode", () => {
    expect(resolveClerkAppearance("dark").theme).toBeDefined();
    expect(resolveClerkAppearance("light").theme).toBeUndefined();
    expect(resolveClerkAppearance(undefined).theme).toBeUndefined();
  });
});
