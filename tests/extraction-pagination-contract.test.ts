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

describe("extraction paginated query contract", () => {
  it("uses Convex paginationResultValidator for paginated result fields", () => {
    const source = readSource(QUERY_FILE);

    expect(source).toMatch(
      /const paginatedAnyResultValidator = paginationResultValidator\(v\.any\(\)\);/
    );
  });

  it("does not return dead payload fields from getJobResultsPaginated", () => {
    const source = readSource(QUERY_FILE);
    const block = getFunctionBlock(source, "getJobResultsPaginated");

    expect(block).toMatch(/\.\.\.paginatedAnyResultValidator\.fields/);
    expect(block).not.toMatch(/\bjob\s*:/);
    expect(block).not.toMatch(/\bquestions\s*:/);
    expect(block).not.toMatch(/query\("extractionQuestions"\)/);
  });
});
