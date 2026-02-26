import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening inline edit contract", () => {
  it("exposes inline edit lifecycle hooks in compact question list", () => {
    const source = readSource("components/search-command-center/components/compact-question-list.tsx");

    expect(source).toMatch(/onEdit: \(index: number, previousQuestion: string, nextQuestion: string\) => boolean/);
    expect(source).toMatch(/const \[editingIndex, setEditingIndex\]/);
    expect(source).toMatch(/const \[draftQuestion, setDraftQuestion\]/);
    expect(source).toMatch(/if \(event\.key === "Enter"/);
    expect(source).toMatch(/if \(event\.key === "Escape"/);
  });

  it("wires edit callback from screening expansion into the list", () => {
    const source = readSource("components/search-command-center/screening-expansion.tsx");

    expect(source).toMatch(/const handleEditQuestion = \(/);
    expect(source).toMatch(/updateScreeningQuestion\(searchId, index, \{ question: normalizedQuestion \}\)/);
    expect(source).toMatch(/onEdit=\{handleEditQuestion\}/);
  });
});
