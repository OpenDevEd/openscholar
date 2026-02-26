import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";

const SOURCE_GLOBS = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
];

const FORBIDDEN_PATTERNS = [
  /runWithLoadingToast\b/,
  /appToast\./,
  /showConfirmationToast\b/,
  /toast\.success\(/,
  /toast\.warning\(/,
  /toast\.info\(/,
  /toast\.ai\.succeeded\(/,
  /toast\.entity\./,
  /toast\.clipboard\.copied\(/,
  /toast\.io\.(importResult|downloadSuccess|uploadSuccess|uploadNoValid)\(/,
  /toast\.job\.(cancelled|deleted|created|duplicated)\(/,
  /toast\.billing\.cancelled\(/,
  /toast\.zotero\.connected\(/,
  /toast\.validation\.warning\(/,
];

function getSourceFiles(): string[] {
  const root = process.cwd();
  return SOURCE_GLOBS.flatMap((pattern) =>
    globSync(pattern, {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: ["**/*.test.ts", "**/*.test.tsx"],
    })
  );
}

describe("error-only toast contract", () => {
  it("prevents non-error toast APIs and legacy toast helpers in app/components/lib", () => {
    const violations: string[] = [];

    for (const filePath of getSourceFiles()) {
      const source = readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(process.cwd(), filePath)} matches ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
