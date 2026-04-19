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
});
