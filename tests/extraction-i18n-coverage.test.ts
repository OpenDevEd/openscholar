import { describe, it, expect } from "vitest";
import enUS from "../messages/en-US.json";
import enGB from "../messages/en-GB.json";
import fr from "../messages/fr.json";
import ja from "../messages/ja.json";
import zh from "../messages/zh.json";
import hi from "../messages/hi.json";

// All new keys added for extraction insights (Phase 83+)
// Existing keys (confidence, avgConf, etc.) are already covered by component usage
const EXTRACTION_INSIGHTS_NEW_KEYS = [
  "confidenceAbstractOnly",
  "confidenceNoContent",
  "confidenceCapExplained",
  "barScalingWarning",
  "progressBarLabel",
  "statusDotComplete",
  "statusDotPartial",
  "statusDotEmpty",
  "answerGrouping",
  "answerGroupingExpand",
  "answerGroupingVariants",
] as const;

type LocaleMessages = typeof enUS;

const locales: Record<string, LocaleMessages> = {
  "en-US": enUS,
  "en-GB": enGB,
  fr: fr as unknown as LocaleMessages,
  ja: ja as unknown as LocaleMessages,
  zh: zh as unknown as LocaleMessages,
  hi: hi as unknown as LocaleMessages,
};

describe("extraction insights i18n coverage", () => {
  it("all new extraction keys exist in all 6 locales", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = messages.extraction as Record<string, unknown>;
      for (const key of EXTRACTION_INSIGHTS_NEW_KEYS) {
        expect(
          extraction,
          `Missing key "${key}" in locale "${locale}"`
        ).toHaveProperty(key);
      }
    }
  });

  it("no translation value is an empty string", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = messages.extraction as Record<string, unknown>;
      for (const key of EXTRACTION_INSIGHTS_NEW_KEYS) {
        expect(
          extraction[key],
          `Empty value for key "${key}" in locale "${locale}"`
        ).not.toBe("");
      }
    }
  });

  it("non-English locales do not contain untranslated key names as values", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      if (locale === "en-US" || locale === "en-GB") continue;
      const extraction = messages.extraction as Record<string, unknown>;
      for (const key of EXTRACTION_INSIGHTS_NEW_KEYS) {
        // The value should not equal the key itself (copy-paste error)
        expect(
          extraction[key],
          `Value equals key name "${key}" in locale "${locale}" — likely untranslated`
        ).not.toBe(key);
      }
    }
  });
});
