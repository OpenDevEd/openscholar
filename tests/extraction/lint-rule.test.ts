// tests/extraction/lint-rule.test.ts
// GAP-03 structural test: protects the no-restricted-syntax rule from silent removal.
// Pattern: RESEARCH.md "Pattern 2: Programmatic ESLint Test (Vitest)".
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");

describe("extraction lint rule: no literal 1000/200", () => {
  it("flags literal 1000 in components/extraction/**/*.tsx", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const source = `
      export function Cap() {
        const limit = 1000;
        return limit;
      }
    `;
    const [result] = await eslint.lintText(source, {
      filePath: "components/extraction/fake-cap.tsx",
    });
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
    expect(restricted[0].message).toContain("MAX_EXTRACTION_PAPERS_PER_JOB");
  });

  it("flags literal 200 in app/extraction/**/*.ts", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const source = `
      export const oldCap = 200;
    `;
    const [result] = await eslint.lintText(source, {
      filePath: "app/extraction/fake-old-cap.ts",
    });
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
    expect(restricted[0].message).toContain("getExtractionLimit");
  });

  it("does NOT flag literal 1000 in test files inside the extraction glob", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const source = `
      import { expect, it } from "vitest";
      it("caps at 1000", () => { expect(1000).toBe(1000); });
    `;
    const [result] = await eslint.lintText(source, {
      filePath: "components/extraction/fake-cap.test.tsx",
    });
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBe(0);
  });

  it("does NOT flag literal 1000 outside the extraction glob", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const source = `
      export const unrelated = 1000;
    `;
    const [result] = await eslint.lintText(source, {
      filePath: "lib/unrelated-module.ts",
    });
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBe(0);
  });
});
