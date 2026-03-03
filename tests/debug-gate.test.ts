import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("requirePublicDebugEnabled", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS;
  });

  it("throws FORBIDDEN when env var is undefined", async () => {
    delete process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS;
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    expect(() => requirePublicDebugEnabled()).toThrow(
      "Debug functions are disabled",
    );
  });

  it("throws FORBIDDEN when env var is 'false'", async () => {
    process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS = "false";
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    expect(() => requirePublicDebugEnabled()).toThrow(
      "Debug functions are disabled",
    );
  });

  it("throws FORBIDDEN when env var is empty string", async () => {
    process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS = "";
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    expect(() => requirePublicDebugEnabled()).toThrow(
      "Debug functions are disabled",
    );
  });

  it("does NOT throw when env var is 'true'", async () => {
    process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS = "true";
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    expect(() => requirePublicDebugEnabled()).not.toThrow();
  });

  it("error message contains 'Debug functions are disabled'", async () => {
    delete process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS;
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    try {
      requirePublicDebugEnabled();
      expect.fail("Expected requirePublicDebugEnabled to throw");
    } catch (error: any) {
      expect(error.data?.message ?? error.message).toContain(
        "Debug functions are disabled",
      );
    }
  });

  it("logs audit event when debug functions are enabled", async () => {
    process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS = "true";
    const logSpy = vi.spyOn(console, "log");
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    requirePublicDebugEnabled();
    expect(logSpy).toHaveBeenCalledWith(
      "[AUDIT:DEBUG_ACCESS]",
      expect.any(String),
    );
    const jsonArg = logSpy.mock.calls.find(
      (call) => call[0] === "[AUDIT:DEBUG_ACCESS]",
    )?.[1];
    const parsed = JSON.parse(jsonArg as string);
    expect(parsed).toHaveProperty("gate", "ENABLE_PUBLIC_DEBUG_FUNCTIONS");
    expect(parsed).toHaveProperty("timestamp");
  });

  it("does NOT log audit event when debug functions are disabled", async () => {
    delete process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS;
    const logSpy = vi.spyOn(console, "log");
    const { requirePublicDebugEnabled } = await import(
      "../convex/lib/debug_gate"
    );
    expect(() => requirePublicDebugEnabled()).toThrow(
      "Debug functions are disabled",
    );
    const auditCalls = logSpy.mock.calls.filter(
      (call) => call[0] === "[AUDIT:DEBUG_ACCESS]",
    );
    expect(auditCalls).toHaveLength(0);
  });
});

describe("debug gate inventory (TEST-05)", () => {
  // All debug/test files in convex/extraction/ that export public or internal
  // functions MUST import requirePublicDebugEnabled. If a new debug/test file
  // is added to convex/extraction/, add it to this list to verify it uses the gate.
  const DEBUG_GATED_FILES = [
    "convex/extraction/debug.ts",
    "convex/extraction/debug_errors.ts",
    "convex/extraction/debug_papers.ts",
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

  // Excluded files (with reasoning):
  // - convex/extraction/test_helpers.ts -- helper functions only, not public-facing, no exported queries/mutations
  // - convex/extraction/testWorkflow.ts -- workflow definition, not directly callable (triggered by test_automation which is gated)

  it.each(DEBUG_GATED_FILES)(
    "%s imports requirePublicDebugEnabled",
    (filePath) => {
      const content = readFileSync(resolve(filePath), "utf-8");
      expect(content).toContain("requirePublicDebugEnabled");
    },
  );
});
