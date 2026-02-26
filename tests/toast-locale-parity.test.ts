import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BASE_LOCALE = "en-US" as const;
const LOCALES = ["en-US", "en-GB", "fr", "hi", "ja", "zh"] as const;

function readToast(locale: (typeof LOCALES)[number]) {
  const filePath = path.resolve(process.cwd(), `messages/${locale}.json`);
  const messages = JSON.parse(readFileSync(filePath, "utf8")) as {
    toast?: Record<string, unknown>;
  };
  return messages.toast ?? {};
}

describe("toast locale parity", () => {
  const baseToast = readToast(BASE_LOCALE);
  const baseKeys = Object.keys(baseToast).sort();

  it("en-US keeps required CTA keys", () => {
    expect(baseToast).toHaveProperty("openAISettings");
    expect(baseToast).toHaveProperty("openBilling");
    expect(baseToast).toHaveProperty("openPricing");
  });

  for (const locale of LOCALES) {
    it(`${locale} has the same toast keyset as ${BASE_LOCALE}`, () => {
      const localeKeys = Object.keys(readToast(locale)).sort();
      expect(localeKeys).toEqual(baseKeys);
    });
  }
});
