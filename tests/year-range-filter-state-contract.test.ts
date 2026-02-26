import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("year range filter state contract", () => {
  it("syncs local inputs from primitive year values to avoid identity reset loops", () => {
    const source = readSource("components/year-range-picker.tsx");

    expect(source).toMatch(/\[syncInputsToRange, yearRange\[0\], yearRange\[1\]\]/);
    expect(source).toContain("const commitFromInput = React.useCallback");
    expect(source).toContain("const commitToInput = React.useCallback");
  });

  it("materializes year params when enabling the year-range toggle", () => {
    const source = readSource("lib/hooks.ts");

    expect(source).toContain("if ('isYearRangeEnabled' in updates)");
    expect(source).toContain("const enabled = Boolean(updates.isYearRangeEnabled);");
    expect(source).toContain("if (enabled) {");
    expect(source).toContain("batchUpdates.yf = requestedRange[0];");
    expect(source).toContain("batchUpdates.yt = requestedRange[1];");
  });
});
