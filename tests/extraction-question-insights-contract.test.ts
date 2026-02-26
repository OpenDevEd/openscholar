import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const QUERY_FILE = "convex/extraction/queries.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

function getFunctionBlock(source: string, functionName: string) {
  const start = source.indexOf(`export const ${functionName} = query({`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n});", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 4);
}

describe("question insights return contract", () => {
  it("validates confidenceBuckets and reviewed fields returned by aggregateQuestionInsights", () => {
    const source = readSource(QUERY_FILE);
    const block = getFunctionBlock(source, "getQuestionInsights");

    expect(block).toMatch(/confidenceBuckets:\s*v\.object\(/);
    expect(block).toMatch(/reviewed:\s*v\.object\(/);
    expect(block).not.toMatch(/reviewStateMix/);
  });
});
