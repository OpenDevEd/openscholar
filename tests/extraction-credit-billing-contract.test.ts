import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKPOOL_ACTIONS_FILE = "convex/extraction/workpoolActions.ts";
const EXTRACTION_MUTATIONS_FILE = "convex/extraction/mutations.ts";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("extraction credit billing contract", () => {
  it("routes extraction question-answering through server-side credit wrapper", () => {
    const source = readSource(WORKPOOL_ACTIONS_FILE);

    expect(source).toMatch(/withUserCreditsBatch/);
    expect(source).toMatch(/calculateServerCreditsToDeduct/);
    expect(source).toMatch(/creditsUsed:\s*extracted\.billedCredits/);
    expect(source).not.toMatch(/Math\.ceil\(latencyMs \/ 1000\)/);
  });

  it("charges embedding indexing via credit deduction mutation", () => {
    const source = readSource(WORKPOOL_ACTIONS_FILE);

    expect(source).toMatch(/EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS/);
    expect(source).toMatch(/internal\.credits\.internal\.deductCredits/);
    expect(source).toMatch(/billingType:\s*"extraction_embedding"/);
  });

  it("keeps failure policy as per-paper failure while the job continues", () => {
    const source = readSource(EXTRACTION_MUTATIONS_FILE);

    expect(source).toMatch(/if \(data\.success && data\.results\)/);
    expect(source).toMatch(/status:\s*"failed"/);
    expect(source).toMatch(/finalizeJobIfDone/);
  });
});
