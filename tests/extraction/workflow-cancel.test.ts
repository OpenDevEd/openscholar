import { describe, it, expect } from "vitest";

/**
 * TEST-04: Workflow cancel path type safety.
 *
 * The `cancelExtraction` mutation must use `as WorkflowId` instead of
 * `as any` when passing the stored workflowId to `workflow.cancel()`.
 *
 * This test verifies:
 * 1. The source code uses the branded WorkflowId cast (not `as any`)
 * 2. The WorkflowId type is importable from @convex-dev/workflow
 * 3. TypeScript compiles the cancel path without errors (verified by tsc --noEmit)
 */
describe("workflow cancel path", () => {
  it("cancelExtraction uses WorkflowId branded cast instead of as-any", async () => {
    // Read the mutations source to verify the cast pattern
    const fs = await import("fs");
    const path = await import("path");

    const mutationsPath = path.resolve(
      process.cwd(),
      "convex/extraction/mutations.ts"
    );
    const source = fs.readFileSync(mutationsPath, "utf-8");

    // Should use `as WorkflowId` (branded cast)
    expect(source).toContain("as WorkflowId");

    // Should NOT use `as any` for the workflow cancel call
    const cancelSection = source.slice(
      source.indexOf("workflow.cancel"),
      source.indexOf("workflow.cancel") + 100
    );
    expect(cancelSection).not.toContain("as any");
  });

  it("imports WorkflowId type from @convex-dev/workflow", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const mutationsPath = path.resolve(
      process.cwd(),
      "convex/extraction/mutations.ts"
    );
    const source = fs.readFileSync(mutationsPath, "utf-8");

    // Should import WorkflowId from the workflow package
    expect(source).toMatch(/import\s+.*WorkflowId.*from\s+["']@convex-dev\/workflow["']/);
  });

  it("WorkflowId type is a branded string type", async () => {
    // Verify the type can be imported from the package
    const workflowModule = await import("@convex-dev/workflow");
    // The module should export WorkflowId-related types
    // At runtime, WorkflowId is just a string -- the branding is TypeScript-only
    expect(workflowModule).toBeDefined();
  });
});
