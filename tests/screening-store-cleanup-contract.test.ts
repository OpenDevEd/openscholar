import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening store cleanup contract", () => {
  it("cleans stale screening responses when questions are edited, removed, or cleared", () => {
    const source = readSource("lib/store.ts");

    expect(source).toMatch(/const removeQuestionFromResponses/);
    expect(source).toMatch(/shouldCleanupResponses/);
    expect(source).toMatch(/removeQuestionFromResponses\(item\.screeningResponses, previousQuestion\)/);
    expect(source).toMatch(/removeQuestionFromResponses\(item\.screeningResponses, removedQuestion\)/);
    expect(source).toMatch(/screeningQuestions: \[\],\s*\n\s*screeningResponses: \{\}/);
  });

  it("adds transient screening helpers for per-question and global cleanup", () => {
    const source = readSource("lib/store.ts");

    expect(source).toMatch(/clearTestIndexPerQuestion: \(key: string\) => void/);
    expect(source).toMatch(/clearAllTestIndexPerQuestion: \(\) => void/);
    expect(source).toMatch(/clearTestIndexPerQuestion: \(key\) =>/);
    expect(source).toMatch(/clearAllTestIndexPerQuestion: \(\) => set\(\{ testIndexPerQuestion: \{\} \}\)/);
  });

  it("removes legacy locked metadata from screening question entries", () => {
    const storeSource = readSource("lib/store.ts");
    const typeSource = readSource("lib/types/screening.types.ts");

    expect(storeSource).toMatch(/addScreeningQuestion: \(id: string, question: string\) => void/);
    expect(typeSource).toMatch(/export interface ScreeningQuestionEntry \{\s*\n\s*question: string;/);
    expect(typeSource).not.toMatch(/locked: boolean/);
  });
});
