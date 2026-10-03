import { dark } from "@clerk/themes";
import { describe, expect, it } from "vitest";
import {
  resolveClerkAppearance,
  resolveClerkLocalization,
} from "../lib/auth/clerk-ui-config";

describe("clerk ui config", () => {
  it("maps app locales to Clerk localization resources", () => {
    expect(resolveClerkLocalization("en-US").locale).toBe("en-US");
    expect(resolveClerkLocalization("en-GB").locale).toBe("en-GB");
    expect(resolveClerkLocalization("fr").locale).toBe("fr-FR");
    expect(resolveClerkLocalization("hi").locale).toBe("hi-IN");
    expect(resolveClerkLocalization("ja").locale).toBe("ja-JP");
    expect(resolveClerkLocalization("zh").locale).toBe("zh-CN");
  });

  it("falls back to language and defaults to en-US when needed", () => {
    expect(resolveClerkLocalization("fr-CA").locale).toBe("fr-FR");
    expect(resolveClerkLocalization("unknown-locale").locale).toBe("en-US");
    expect(resolveClerkLocalization(undefined).locale).toBe("en-US");
  });

  it("uses Clerk's dark base in the three dark themes and not in the white one", () => {
    for (const theme of ["navy", "dark", "blue"]) {
      expect(resolveClerkAppearance(theme).theme).toBe(dark);
    }
    expect(resolveClerkAppearance("light").theme).toBeUndefined();
    expect(resolveClerkAppearance(undefined).theme).toBeUndefined();
  });
});
