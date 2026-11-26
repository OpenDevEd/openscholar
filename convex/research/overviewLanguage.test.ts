import { describe, expect, it } from "vitest";
import { looksEnglish } from "./overviewWriter";

describe("an overview written in the wrong language", () => {
  it("is told apart from one in the page's language", () => {
    // The English one a French page got on 2026-11-26, and the French one it should have been.
    expect(looksEnglish("The search covers 44 papers, centred on school meals and school-based policy. Output is spread across the years, with most papers from 2020 and 2025.")).toBe(true);
    expect(looksEnglish("Cette recherche est très petite : elle ne compte que deux articles, un de 2021 et un de 2024, tous deux sur les repas scolaires.")).toBe(false);
    expect(looksEnglish("Die Suche umfasst 44 Artikel über Schulmahlzeiten, die meisten aus den Jahren 2020 und 2025.")).toBe(false);
    expect(looksEnglish("この検索は学校給食に関する44件の論文を対象としています。")).toBe(false);
  });
});
