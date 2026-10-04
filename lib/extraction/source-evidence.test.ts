import { expect, it } from "vitest";
import { abstractEvidence, normalizedAbstract, validatedAbstractCitations, type SourceCitation } from "./source-evidence";

it("anchors exact saved abstract passages without pages or guessed source identities", async () => {
  const source = "  في الدراسة، شملت العينة 120 مدرسة.\nReading improved by 0.24 standard deviations. ";
  const first = await abstractEvidence("paper-a", source);
  expect(first).toEqual(await abstractEvidence("paper-a", source));
  expect(first.text).toBe("في الدراسة، شملت العينة 120 مدرسة. Reading improved by 0.24 standard deviations.");
  const unit = first.units[0];
  const citation: SourceCitation = { source: "abstract", evidenceId: unit.evidenceId, paperId: "paper-a", sourceHash: first.sourceHash, charRange: unit.charRange, quote: unit.text, retrieval: {}, validated: true };
  expect(await validatedAbstractCitations("paper-a", source, [citation])).toEqual([citation]);
  expect(citation).not.toHaveProperty("page");
  for (const forged of [{ ...citation, paperId: "paper-b" }, { ...citation, sourceHash: "old" }, { ...citation, evidenceId: "invented" }, { ...citation, quote: "Unsupported claim" }, { ...citation, charRange: [0, 1] as [number, number] }]) {
    expect(await validatedAbstractCitations("paper-a", source, [forged])).toEqual([]);
  }
  expect(await validatedAbstractCitations("paper-a", source + " A later revision.", [citation])).toEqual([]);
});

it("keeps every character of a long abstract in bounded passages", async () => {
  const source = "بحث عن المدارس والقراءة. ".repeat(10_000);
  const evidence = await abstractEvidence("long-paper", source);
  expect(evidence.units.length).toBeLessThanOrEqual(200);
  expect(evidence.units.map(unit => unit.text).join(" ")).toBe(normalizedAbstract(source));
  for (const unit of evidence.units) expect(evidence.text.slice(...unit.charRange)).toBe(unit.text);
});
