import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const QUERY_WRAPPER_FILE = "lib/auth/use-auth-query.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("paginated settlement contract", () => {
  it("maps LoadingFirstPage to query_loading semantics", () => {
    const source = readSource(QUERY_WRAPPER_FILE);

    expect(source).toMatch(
      /const hasLoadedFirstPage = paginated\.status !== "LoadingFirstPage"/,
    );
    expect(source).toMatch(/\n\s*settlement,\n/);
    expect(source).not.toMatch(/settlement:\s*"ready"/);
  });

  it("exposes paginated readiness metadata", () => {
    const source = readSource(QUERY_WRAPPER_FILE);

    expect(source).toMatch(/isInitialLoading:\s*boolean/);
    expect(source).toMatch(/hasLoadedFirstPage:\s*boolean/);
    expect(source).toMatch(/isSettled:\s*boolean/);
    expect(source).toMatch(/isReady:\s*hasLoadedFirstPage/);
  });
});
