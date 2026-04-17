import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("debug function internal registration", () => {
  const DEBUG_FILES = [
    "convex/extraction/debug.ts",
    "convex/extraction/debug_errors.ts",
    "convex/extraction/debug_paper_results.ts",
    "convex/extraction/debug_job_content.ts",
    "convex/extraction/debug_job_citations.ts",
    "convex/extraction/debug_pdfjs_alignment.ts",
    "convex/extraction/testActions.ts",
    "convex/extraction/test_runner.ts",
    "convex/extraction/test_automation.ts",
    "convex/extraction/test_automation_internal.ts",
    "convex/extraction/create_test_job.ts",
  ];

  it.each(DEBUG_FILES)(
    "%s uses only internal function registrations",
    (filePath) => {
      const content = readFileSync(resolve(filePath), "utf-8");

      // Must use at least one internal registration
      expect(content).toMatch(/internal(Query|Mutation|Action)/);

      // Must NOT contain requirePublicDebugEnabled
      expect(content).not.toContain("requirePublicDebugEnabled");

      // Must NOT reference debug_gate
      expect(content).not.toContain("debug_gate");
    },
  );

  it("debug_gate.ts does not exist", () => {
    expect(() =>
      readFileSync(resolve("convex/lib/debug_gate.ts"), "utf-8"),
    ).toThrow();
  });
});
