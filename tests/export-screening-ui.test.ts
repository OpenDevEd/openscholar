import { describe, it, expect } from "vitest";
import enUS from "../messages/en-US.json";
import enGB from "../messages/en-GB.json";
import fr from "../messages/fr.json";
import ja from "../messages/ja.json";
import zh from "../messages/zh.json";
import hi from "../messages/hi.json";

const EXPORT_KEYS = [
  "exportButton",
  "exportCSV",
  "exportJSON",
  "exportXLSX",
  "exportIncompleteWarning",
  "exportLoading",
] as const;

const locales = {
  "en-US": enUS,
  "en-GB": enGB,
  fr,
  ja,
  zh,
  hi,
} as const;

describe("screening export translation keys", () => {
  it("all export keys exist in en-US screeningDialog", () => {
    const dialog = enUS.screeningDialog as Record<string, unknown>;
    for (const key of EXPORT_KEYS) {
      expect(dialog).toHaveProperty(key);
    }
  });

  it("all 6 locale files have identical export key sets", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const dialog = (messages as Record<string, Record<string, unknown>>)
        .screeningDialog;
      for (const key of EXPORT_KEYS) {
        expect(
          dialog,
          `Missing key "${key}" in ${locale}`
        ).toHaveProperty(key);
      }
    }
  });

  it("no export translation value is an empty string", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const dialog = (messages as Record<string, Record<string, unknown>>)
        .screeningDialog;
      for (const key of EXPORT_KEYS) {
        const value = dialog[key];
        expect(
          value,
          `Empty value for "${key}" in ${locale}`
        ).not.toBe("");
      }
    }
  });
});
