import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("search-actions screening export contract", () => {
  it("attaches screening_results only for JSON exports", () => {
    const source = readSource("lib/search-actions.ts");

    expect(source).toMatch(/function withScreeningResults/);
    expect(source).toMatch(/if \(format !== 'json'\)/);
    expect(source).toMatch(/screening_results: screeningResults/);
  });

  it("uses screening responses in both essential and full result export flows", () => {
    const source = readSource("lib/search-actions.ts");

    expect(source).toMatch(/getEssentialInfo\(item, ratings, screeningResponses, format\)/);
    expect(source).toMatch(/withScreeningResults\(\s*\{\s*\.\.\.item,\s*rating:/);
    expect(source).toMatch(/getScreeningResponsesForSearch\(searchState\)/);
    expect(source).toMatch(/\.\.\.\(item\.doi \? \{ doi: item\.doi \} : \{\}\)/);
    expect(source).toMatch(/\.\.\.\(item\.open_access\?\.oa_url \? \{ pdf_url: item\.open_access\.oa_url \} : \{\}\)/);
  });
});
