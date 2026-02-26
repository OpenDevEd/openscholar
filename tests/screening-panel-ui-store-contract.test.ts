import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening panel ui store contract", () => {
  it("defines per-search screening panel open state and helpers", () => {
    const source = readSource("lib/store.ts");

    expect(source).toMatch(/screeningPanelOpenBySearchId: Record<string, boolean>/);
    expect(source).toMatch(/getScreeningPanelOpen: \(searchId: string\) => boolean/);
    expect(source).toMatch(/setScreeningPanelOpen: \(searchId: string, open: boolean\) => void/);
    expect(source).toMatch(/toggleScreeningPanel: \(searchId: string\) => void/);
    expect(source).toMatch(/screeningPanelOpenBySearchId: \{\}/);
  });

  it("persists screening panel state in ui-store partialize", () => {
    const source = readSource("lib/store.ts");
    const storeStart = source.indexOf("name: 'ui-store'");
    expect(storeStart).toBeGreaterThan(-1);

    const storeSnippet = source.slice(storeStart, storeStart + 1000);
    expect(storeSnippet).toMatch(/partialize: \(state\) => \(\{/);
    expect(storeSnippet).toMatch(/screeningPanelOpenBySearchId: state\.screeningPanelOpenBySearchId/);
  });
});
