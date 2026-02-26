import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("screening no-toast contract", () => {
  it("keeps screening feedback inline and avoids toast API usage", () => {
    const source = readSource("components/search-command-center/screening-expansion.tsx");

    expect(source).toMatch(/aria-live="polite"/);
    expect(source).toMatch(/role="status"/);
    expect(source).toMatch(/inlineStatus/);
    expect(source).not.toMatch(/useAppToast/);
    expect(source).not.toMatch(/toast\./);
  });
});
