import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

describe("fetch timeout safety (CRASH-06)", () => {
  it("all fetch calls in convex/ have AbortSignal.timeout or signal", () => {
    // Find every `await fetch(` call in convex/ .ts files (excluding tests/imports/comments)
    // Then check that within 8 lines of context, AbortSignal or signal: appears
    // If any fetch call lacks a signal within its options block, the test fails
    const allFetches = execSync(
      'grep -rn "await fetch(" convex/ --include="*.ts" | grep -v "\\.test\\." | grep -v "^[^:]*:[^:]*://"',
      { encoding: "utf-8" }
    ).trim();

    if (!allFetches) {
      // No fetch calls found at all -- nothing to check
      return;
    }

    const unguarded: string[] = [];

    for (const line of allFetches.split("\n")) {
      // Extract file:lineNumber
      const match = line.match(/^([^:]+):(\d+):/);
      if (!match) continue;
      const [, file, lineStr] = match;
      const lineNum = parseInt(lineStr, 10);

      // Read 8 lines of context after the fetch call to find signal/AbortSignal
      const context = execSync(
        `sed -n '${lineNum},${lineNum + 8}p' "${file}"`,
        { encoding: "utf-8" }
      );

      if (!/AbortSignal|signal[:}\s,)]/.test(context)) {
        unguarded.push(`${file}:${lineNum}`);
      }
    }

    expect(
      unguarded,
      `Unguarded fetch calls found (missing AbortSignal.timeout): ${unguarded.join(", ")}`
    ).toEqual([]);
  });
});
