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

  it("shows a locked trigger state for results translation when plan is not entitled", () => {
    const source = readSource(
      "components/search-command-center/components/results-translation-control.tsx"
    );

    expect(source).toMatch(/import \{ Check, Globe2, Loader2, Lock, Sparkles \} from "lucide-react"/);
    expect(source).toContain("import Link from \"next/link\";");
    expect(source).toContain("const isLocked = !isPlanEntitled;");
    expect(source).toContain("const showActiveTranslationState = !isLocked && autoTranslateResults;");
    expect(source).toContain("const triggerAriaLabel = isLocked");
    expect(source).toContain("<Globe2 className=\"h-4 w-4\" />");
    expect(source).toContain("<Lock className=\"h-3.5 w-3.5 opacity-70\" />");
    expect(source).toContain("<TooltipContent sideOffset={6} className=\"max-w-52 px-2.5 py-2 text-xs leading-relaxed\">");
    expect(source).toContain("{tc(\"upgradeTo\", { plan: \"Go\" })} →");
  });
});
