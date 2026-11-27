import { describe, expect, it } from "vitest";
import { looksEnglish, partlyEnglish } from "./overviewWriter";

describe("an overview written in the wrong language", () => {
  it("is told apart from one in the page's language", () => {
    // The English one a French page got on 2026-11-26, and the French one it should have been.
    expect(looksEnglish("The search covers 44 papers, centred on school meals and school-based policy. Output is spread across the years, with most papers from 2020 and 2025.")).toBe(true);
    expect(looksEnglish("Cette recherche est très petite : elle ne compte que deux articles, un de 2021 et un de 2024, tous deux sur les repas scolaires.")).toBe(false);
    expect(looksEnglish("Die Suche umfasst 44 Artikel über Schulmahlzeiten, die meisten aus den Jahren 2020 und 2025.")).toBe(false);
    expect(looksEnglish("この検索は学校給食に関する44件の論文を対象としています。")).toBe(false);
  });

  it("is caught when only one of its paragraphs is in English", () => {
    // The overview a French page got on 2026-11-27: an English paragraph, then French ones. Read whole, it passed for French.
    const french = "Les quatre travaux de cette recherche portent sur l'accompagnement scolaire, surtout le tutorat entre pairs à l'école primaire et au collège, avec un regard sur les gestes professionnels des formateurs d'enseignants et sur le rôle du numérique dans l'étayage. Ils s'échelonnent de 2009 à 2023 et sont tous en français, avec une seule affiliation nationale : la France.\n\nPour commencer, la plus récente est [L’accompagnement des élèves par le tutorat entre pairs](paper:W4407083749), qui repose sur des entretiens qualitatifs avec des élèves tuteurs et tutorés.\n[chart:c2]";
    const mixed = `The search returns only four papers, so it's a narrow base. Its subject is peer tutoring and teacher mentoring in French-language primary and secondary education.\n\n${french}`;
    expect(looksEnglish(mixed)).toBe(false);
    expect(partlyEnglish(mixed)).toBe(true);
    expect(partlyEnglish(french)).toBe(false);
    // A short paragraph in another language that shares one of the English words is not English.
    expect(partlyEnglish("Die Suche umfasst 44 Artikel über Schulmahlzeiten, die meisten aus den Jahren 2020 und 2025.\n\nWas bedeutet das für die Praxis?")).toBe(false);
  });
});
