import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["en-US", "en-GB", "fr", "hi", "ja", "zh"] as const;

const EXTRACTION_GATE_KEYS = [
  "planGateBadge",
  "planGateTitle",
  "planGateDescription",
  "planGatePrimaryCta",
  "planGateHowItWorksTitle",
  "planGateHowItWorksDescription",
  "planGateStep1Title",
  "planGateStep1Description",
  "planGateStep2Title",
  "planGateStep2Description",
  "planGateStep3Title",
  "planGateStep3Description",
  "planGateWhatYouCanExtractTitle",
  "planGateWhatYouCanExtractDescription",
  "planGateCardOutcomesTitle",
  "planGateCardOutcomesDescription",
  "planGateCardMethodsTitle",
  "planGateCardMethodsDescription",
  "planGateCardPopulationTitle",
  "planGateCardPopulationDescription",
  "planGateProNote",
] as const;

function readMessages(locale: (typeof LOCALES)[number]) {
  const filePath = path.resolve(process.cwd(), `messages/${locale}.json`);
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    extraction?: Record<string, unknown>;
  };
}

describe("extraction locale parity", () => {
  for (const locale of LOCALES) {
    it(`${locale} includes all extraction plan gate keys`, () => {
      const messages = readMessages(locale);
      const extraction = messages.extraction ?? {};

      for (const key of EXTRACTION_GATE_KEYS) {
        expect(extraction, `${locale} missing extraction.${key}`).toHaveProperty(key);
      }
    });
  }
});
