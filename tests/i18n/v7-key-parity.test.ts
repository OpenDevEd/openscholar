// tests/i18n/v7-key-parity.test.ts
// Phase 105 D-23 through D-26: every v7.0 i18n key exists in every locale,
// and curated French keys retain their diacritics.
// Pattern: RESEARCH.md Pattern 7 + tests/locale-detection.test.ts style.

import { describe, it, expect } from "vitest";
import enUS from "@/messages/en-US.json";
import enGB from "@/messages/en-GB.json";
import fr from "@/messages/fr.json";
import hi from "@/messages/hi.json";
import ja from "@/messages/ja.json";
import zh from "@/messages/zh.json";

/** Flattens a JSON object into sorted dot-path keys.
 * Treats arrays + primitives + null as leaves (the path to them is the key). */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const LOCALES: Record<string, unknown> = {
  "en-US": enUS,
  "en-GB": enGB,
  fr,
  hi,
  ja,
  zh,
};

/** Walks a dot-path inside a locale object; returns undefined if missing. */
function walk(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc as Record<string, unknown> | null | undefined)?.[k],
    obj,
  );
}

/** v7.0 French sample key paths curated at plan-write time.
 * Each value in fr.json for these paths MUST contain at least one French diacritic.
 * D-25 mandates 8-10 samples — bounds encoded below as tripwires. */
const FRENCH_DIACRITIC_SAMPLES: readonly string[] = [
  "extraction.workbench.mobileViewFallbackToast", // "Passage à la vue tableau pour mobile"
  "extraction.confidenceHigh",                    // "Confiance élevée"
  "extraction.criticVerified",                    // "Vérifié"
  "extraction.criticPartial",                     // "Partiellement vérifié"
  "extraction.basket.emptyBody",                  // "Ajoutez des articles depuis votre bibliothèque..."
  "extraction.basket.sourceLabel.library",        // "Bibliothèque"
  "extraction.basket.alreadyInBasket",            // "Déjà dans votre panier d'extraction"
  "extraction.addButton.inBasket",                // "Déjà dans le panier"
] as const;

const FRENCH_DIACRITIC_REGEX = /[éèêëàâäôöûüùïîçÉÈÊËÀÂÄÔÖÛÜÙÏÎÇ]/;

describe("i18n v7.0 key parity", () => {
  it("every locale has the same set of keys as en-US", () => {
    const reference = flatten(LOCALES["en-US"]);
    expect(reference.length).toBeGreaterThan(0); // sanity: en-US loaded

    for (const [locale, data] of Object.entries(LOCALES)) {
      if (locale === "en-US") continue;
      const keys = flatten(data);
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect(
        missing,
        `Locale '${locale}' is MISSING these keys present in en-US: ${missing.join(", ")}`,
      ).toEqual([]);
      expect(
        extra,
        `Locale '${locale}' has EXTRA keys not present in en-US: ${extra.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("french keys retain diacritics for curated v7.0 samples", () => {
    // D-25: between 8 and 10 curated samples — tripwire for shrinkage/bloat.
    expect(
      FRENCH_DIACRITIC_SAMPLES.length,
      "FRENCH_DIACRITIC_SAMPLES must have at least 8 entries (D-25).",
    ).toBeGreaterThanOrEqual(8);
    expect(
      FRENCH_DIACRITIC_SAMPLES.length,
      "FRENCH_DIACRITIC_SAMPLES must have at most 10 entries (D-25 curated spot-check, not exhaustive parity).",
    ).toBeLessThanOrEqual(10);

    for (const path of FRENCH_DIACRITIC_SAMPLES) {
      const value = walk(fr, path);
      expect(
        typeof value === "string",
        `fr locale: path '${path}' did not resolve to a string (got ${typeof value}).`,
      ).toBe(true);
      expect(
        typeof value === "string" && FRENCH_DIACRITIC_REGEX.test(value),
        `fr locale: path '${path}' value ${JSON.stringify(value)} missing French diacritic.`,
      ).toBe(true);
    }
  });
});
