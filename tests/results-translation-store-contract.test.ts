import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("results translation settings store contract", () => {
  it("defines persisted auto translation preferences with manual run signal", () => {
    const source = readSource("lib/store.ts");

    expect(source).toMatch(/interface ResultsTranslationSettingsState/);
    expect(source).toMatch(/autoTranslateResults: boolean/);
    expect(source).toMatch(/targetLanguageOverride: string \| null/);
    expect(source).toMatch(/manualRunRequestId: number/);
    expect(source).toMatch(/name: "results-translation-settings-store"/);
    expect(source).toMatch(/autoTranslateResults: false/);
    expect(source).toMatch(/targetLanguageOverride: null/);
    expect(source).toMatch(/manualRunRequestId: 0/);
    expect(source).toMatch(/requestManualRun: \(\) =>\s*set\(\(state\) => \(\{ manualRunRequestId: state\.manualRunRequestId \+ 1 \}\)\)/);
  });

  it("persists only stable settings and excludes manual run request id", () => {
    const source = readSource("lib/store.ts");
    const storeStart = source.indexOf('name: "results-translation-settings-store"');
    expect(storeStart).toBeGreaterThan(-1);

    const storeSnippet = source.slice(storeStart, storeStart + 500);
    expect(storeSnippet).toMatch(/partialize: \(state\) => \(\{/);
    expect(storeSnippet).toMatch(/autoTranslateResults: state\.autoTranslateResults/);
    expect(storeSnippet).toMatch(/targetLanguageOverride: state\.targetLanguageOverride/);
    expect(storeSnippet).not.toMatch(/manualRunRequestId/);
  });
});
