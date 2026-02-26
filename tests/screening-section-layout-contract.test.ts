import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening section layout contract", () => {
  it("wires footer and expansion to shared panel id and question count", () => {
    const source = readSource("components/search-command-center/index.tsx");

    expect(source).toContain("const screeningPanelId = `screening-panel-${searchId || \"active\"}`;");
    expect(source).toMatch(/screeningQuestionCount = useSearchHistoryStore/);
    expect(source).toMatch(/screeningPanelId=\{screeningPanelId\}/);
    expect(source).toMatch(/screeningQuestionCount=\{screeningQuestionCount\}/);
    expect(source).toMatch(/panelId=\{screeningPanelId\}/);
  });

  it("exposes screen toggle as an aria-connected segmented action", () => {
    const footer = readSource("components/search-command-center/search-command-footer.tsx");

    expect(footer).toMatch(/inline-flex items-center rounded-2xl border/);
    expect(footer).toMatch(/aria-expanded=\{isScreeningOpen\}/);
    expect(footer).toMatch(/aria-controls=\{screeningPanelId\}/);
    expect(footer).toMatch(/screeningQuestionCount/);
  });

  it("marks expansion panel as a labeled region", () => {
    const expansion = readSource("components/search-command-center/screening-expansion.tsx");

    expect(expansion).toMatch(/id=\{panelId\}/);
    expect(expansion).toMatch(/role="region"/);
    expect(expansion).toMatch(/aria-labelledby=\{`\$\{panelId\}-title`\}/);
    expect(expansion).toMatch(/aria-live="polite"/);
    expect(expansion).toMatch(/role="status"/);
  });
});
