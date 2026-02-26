import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("results translation controls contract", () => {
  it("renders results translation control inside segmented screening action cluster", () => {
    const source = readSource("components/search-command-center/search-command-footer.tsx");

    expect(source).toMatch(/import \{ ResultsTranslationControl \} from "\.\/components\/results-translation-control"/);
    expect(source).toMatch(/triggerVariant="ghost"/);
    expect(source).toMatch(/compactTrigger/);
    expect(source).toMatch(/inline-flex items-center rounded-2xl border/);
    expect(source).toMatch(/onClick=\{handleScreeningToggle\}/);
  });

  it("wires manual and automatic results translation settings into batch hook", () => {
    const source = readSource("components/results-list.tsx");

    expect(source).toMatch(/autoTranslateResults = useResultsTranslationSettingsStore/);
    expect(source).toMatch(/targetLanguageOverride = useResultsTranslationSettingsStore/);
    expect(source).toMatch(/manualRunRequestId = useResultsTranslationSettingsStore/);
    expect(source).toMatch(/autoTranslateResults,/);
    expect(source).toMatch(/manualRunRequestId,/);
    expect(source).toMatch(/targetLanguageOverride,/);
  });

  it("gates translation execution by auto mode or manual run request", () => {
    const source = readSource("hooks/use-batch-translation.ts");

    expect(source).toMatch(/\(autoTranslateResults \|\| hasPendingManualRun\)/);
    expect(source).toMatch(/lastConsumedManualRunRequestIdRef\.current = manualRunRequestId/);
    expect(source).toMatch(/beforeExecute/);
  });
});
