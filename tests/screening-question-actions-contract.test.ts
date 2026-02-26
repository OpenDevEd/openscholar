import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening question actions contract", () => {
  it("keeps per-question actions always visible with touch-friendly targets", () => {
    const source = readSource("components/search-command-center/components/compact-question-list.tsx");

    expect(source).not.toMatch(/opacity-0 group-hover:opacity-100/);
    expect(source).toMatch(/className="h-9 w-9"/);
    expect(source).toMatch(/line-clamp-2 text-sm leading-5/);
    expect(source).toMatch(/title=\{tc\("edit"\)\}/);
    expect(source).toMatch(/title=\{tc\("save"\)\}/);
    expect(source).toMatch(/title=\{tc\("cancel"\)\}/);
    expect(source).toMatch(/if \(event\.key === "Enter"/);
    expect(source).toMatch(/if \(event\.key === "Escape"/);
  });

  it("uses explicit visible batch actions and primary generate action in expansion", () => {
    const source = readSource("components/search-command-center/screening-expansion.tsx");

    expect(source).toMatch(/t\("common\.add"\)/);
    expect(source).toMatch(/t\("common\.generate"\)/);
    expect(source).toMatch(/t\("searchCommand\.testAllQuestions"\)/);
    expect(source).toMatch(/t\("searchCommand\.clearAllQuestions"\)/);
    expect(source).toMatch(/onEdit=\{handleEditQuestion\}/);
    expect(source).not.toMatch(/DropdownMenu/);
  });
});
