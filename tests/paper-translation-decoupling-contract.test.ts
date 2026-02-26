import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("paper translation decoupling contract", () => {
  it("keeps paper translation hook independent from selected/source language", () => {
    const source = readSource("hooks/use-batch-translation.ts");

    expect(source).not.toMatch(/selectedLanguage/);
    expect(source).not.toMatch(/sourceLanguage/);
    expect(source).toMatch(/targetLanguageOverride/);
  });

  it("uses target-only translation keys in translation store", () => {
    const source = readSource("lib/store.ts");

    expect(source).toMatch(/function translationKey\(paperId: string, targetLanguage: string\)/);
    expect(source).toContain("return `${paperId}:${targetLanguage}`;");
    expect(source).not.toContain("translationKey(paperId, data.sourceLanguage");
  });

  it("drops source language from server and client batch translation contracts", () => {
    const executor = readSource("lib/ai/client/executor.ts");
    const actions = readSource("convex/ai/actions.ts");
    const batchTypes = readSource("lib/ai/core/batch-types.ts");

    expect(executor).not.toMatch(/sourceLanguage/);
    expect(actions).not.toMatch(/sourceLanguage/);
    expect(batchTypes).not.toMatch(/sourceLanguage/);
  });

  it("builds paper translation prompts with source auto-detection", () => {
    const prompts = readSource("lib/ai/core/prompts.ts");

    expect(prompts).toMatch(/Detect the original language and translate this academic paper content TO/);
    expect(prompts).not.toMatch(/Translate this academic paper content FROM/);
  });
});
