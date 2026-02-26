import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_FILE = "convex/extraction/workflow.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("extraction workflow env-safety contract", () => {
  it("reads PDF feature flag through an internal query instead of direct env access", () => {
    const source = readSource(WORKFLOW_FILE);

    expect(source).not.toMatch(/isPdfExtractionEnabled\(/);
    expect(source).toMatch(
      /step\.runQuery\(\s*internal\.extraction\.queries\.getPdfExtractionEnabledInternal,\s*\{\}\s*\)/
    );
  });

  it("passes resolved pdfEnabled into processable flag computation", () => {
    const source = readSource(WORKFLOW_FILE);

    expect(source).toMatch(/getProcessableFlags\(\{[\s\S]*pdfEnabled,[\s\S]*\}\)/);
  });
});
