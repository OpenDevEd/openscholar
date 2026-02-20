import { describe, expect, it } from "vitest";
import { detectLocaleFromAcceptLanguage } from "../i18n/locale-detection";

describe("locale detection", () => {
  it("returns default locale for empty or null header", () => {
    expect(detectLocaleFromAcceptLanguage(null)).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("   ")).toBe("en-US");
  });

  it("matches exact locale from Accept-Language", () => {
    expect(detectLocaleFromAcceptLanguage("en-US")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("zh")).toBe("zh");
    expect(detectLocaleFromAcceptLanguage("fr")).toBe("fr");
    expect(detectLocaleFromAcceptLanguage("ja")).toBe("ja");
    expect(detectLocaleFromAcceptLanguage("hi")).toBe("hi");
    expect(detectLocaleFromAcceptLanguage("en-GB")).toBe("en-GB");
  });

  it("uses best-fit matching for regional variants", () => {
    expect(detectLocaleFromAcceptLanguage("zh-CN")).toBe("zh");
    expect(detectLocaleFromAcceptLanguage("zh-TW")).toBe("zh");
    expect(detectLocaleFromAcceptLanguage("fr-FR")).toBe("fr");
    expect(detectLocaleFromAcceptLanguage("en-AU")).toBe("en-GB");
  });

  it("respects q-value ordering", () => {
    expect(detectLocaleFromAcceptLanguage("zh,en-US;q=0.9")).toBe("zh");
    expect(detectLocaleFromAcceptLanguage("en-US;q=0.9,zh")).toBe("zh");
  });

  it("filters out asterisk wildcard", () => {
    expect(detectLocaleFromAcceptLanguage("*")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("*,zh;q=0.9")).toBe("zh");
  });

  it("handles malformed q-values", () => {
    expect(detectLocaleFromAcceptLanguage("en-US;q=bad")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("zh;q=2,en-US;q=invalid")).toBe("zh");
  });

  it("returns default for unsupported locales", () => {
    expect(detectLocaleFromAcceptLanguage("ar")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("de")).toBe("en-US");
    expect(detectLocaleFromAcceptLanguage("es")).toBe("en-US");
  });
});
