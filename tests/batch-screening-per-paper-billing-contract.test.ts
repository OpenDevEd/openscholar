import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("batch screening per-paper billing contract", () => {
  it("emits per-paper usage breakdown with screening metadata", () => {
    const source = readSource("convex/ai/actions.ts");

    expect(source).toMatch(/usageByItemId/);
    expect(source).toMatch(/usageBreakdown/);
    expect(source).toMatch(/billingType:\s*"batch_screening"/);
    expect(source).toMatch(/description:\s*`AI: Batch screening \(\$\{paperId\}\)`/);
  });

  it("deducts batch credits per usageBreakdown entry", () => {
    const source = readSource("convex/ai/helpers.ts");

    expect(source).toMatch(/usageBreakdown && usageBreakdown\.length > 0/);
    expect(source).toMatch(/for \(const entry of usageBreakdown\)/);
    expect(source).toMatch(/calculateServerCreditsToDeduct\(entry\.usage\)/);
  });
});
