import { describe, it, expect } from "vitest";
import { scoreSource, type ScorerInput } from "@/lib/chat/search/source-scorer";

const baseRow: ScorerInput = {
  title: "Photosynthesis in marine algae",
  authors: ["Smith, J", "Doe, A"],
  year: 2024,
  abstract: "We examine the use of photosynthesis in marine systems.",
  doi: "10.1234/abc.2024",
  openalexId: "W1234567890",
};

describe("scoreSource", () => {
  it("R1: empty query returns { score: 1, field: null } for any row", () => {
    expect(scoreSource(baseRow, "")).toEqual({ score: 1, field: null });
    expect(scoreSource(baseRow, "   ")).toEqual({ score: 1, field: null });
    expect(scoreSource({ ...baseRow, title: "" }, "")).toEqual({
      score: 1,
      field: null,
    });
  });

  it("R2: DOI exact-match (case-insensitive) returns top score with field='doi'", () => {
    expect(scoreSource(baseRow, "10.1234/abc.2024")).toEqual({
      score: 1,
      field: "doi",
    });
    expect(scoreSource(baseRow, "10.1234/ABC.2024")).toEqual({
      score: 1,
      field: "doi",
    });
    expect(scoreSource(baseRow, "  10.1234/abc.2024  ")).toEqual({
      score: 1,
      field: "doi",
    });
  });

  it("R3: OpenAlex ID exact-match returns top score with field='openalexId'", () => {
    expect(scoreSource(baseRow, "W1234567890")).toEqual({
      score: 1,
      field: "openalexId",
    });
    expect(scoreSource(baseRow, "w1234567890")).toEqual({
      score: 1,
      field: "openalexId",
    });
  });

  it("R4: title substring match returns field='title' and a positive score", () => {
    const result = scoreSource(baseRow, "marine algae");
    expect(result.field).toBe("title");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("R5: author-only substring match returns field='authors'", () => {
    const result = scoreSource(baseRow, "doe");
    expect(result.field).toBe("authors");
    expect(result.score).toBeGreaterThan(0);
  });

  it("R6: year match (string of the row's year) returns field='year'", () => {
    const result = scoreSource(baseRow, "2024");
    expect(result.field).toBe("year");
    expect(result.score).toBeGreaterThan(0);
  });

  it("R7: abstract-only match returns field='abstract' and ranks below a title-only match for the same query", () => {
    const abstractOnly: ScorerInput = {
      ...baseRow,
      title: "Unrelated topic",
      authors: [],
      abstract: "We examine the use of photosynthesis in marine systems.",
    };
    const titleOnly: ScorerInput = {
      ...baseRow,
      title: "photosynthesis",
      abstract: null,
    };
    const a = scoreSource(abstractOnly, "photosynthesis");
    const t = scoreSource(titleOnly, "photosynthesis");
    expect(a.field).toBe("abstract");
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThan(t.score);
  });
});
