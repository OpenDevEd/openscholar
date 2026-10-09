import { describe, expect, it } from "vitest";
import { queryScope } from "./query-scope";

describe("queryScope", () => {
  it("tells OQL, a question asked by meaning and keywords apart", () => {
    expect(queryScope("oql")).toBe("oql");
    expect(queryScope("semantic")).toBe("semantic");
    for (const field of ["title_and_abstract", "default", "title", "abstract", "fulltext", "display_name", undefined]) {
      expect(queryScope(field)).toBe("keywords");
    }
  });
});
