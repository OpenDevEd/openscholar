import { describe, expect, it } from "vitest";
import type { PaperWithResults, Question } from "../lib/extraction/filtering";
import {
  filterPapers,
  preprocessPapers,
} from "../lib/extraction/filtering";
import { getStatusFilterOptionIds } from "../lib/extraction/status-filter-options";

describe("extraction result filtering with pdfEnabled parameter", () => {
  const paperWithoutPdf = {
    _id: "paper_1",
    title: "Abstract-only paper",
    results: [],
    pdfUrl: undefined,
    storageId: undefined,
    pdfContentUsed: false,
    isOpenAccess: false,
    status: "completed",
  } as unknown as PaperWithResults;

  const questions: Question[] = [];

  function buildFilters() {
    return {
      searchQuery: "",
      confidenceRange: [0, 100] as [number, number],
      statusFilters: new Set(["has-pdf"]),
      questionFilters: new Map(),
    };
  }

  it("applies has-pdf filter when pdfEnabled is true", () => {
    const preprocessed = preprocessPapers([paperWithoutPdf]);

    const filtered = filterPapers(
      [paperWithoutPdf],
      buildFilters(),
      questions,
      preprocessed,
      true,
    );

    expect(filtered).toHaveLength(0);
  });

  it("ignores has-pdf filter when pdfEnabled is false", () => {
    const preprocessed = preprocessPapers([paperWithoutPdf]);

    const filtered = filterPapers(
      [paperWithoutPdf],
      buildFilters(),
      questions,
      preprocessed,
      false,
    );

    expect(filtered).toHaveLength(1);
  });

  it("defaults pdfEnabled to true when omitted", () => {
    const preprocessed = preprocessPapers([paperWithoutPdf]);

    const filtered = filterPapers(
      [paperWithoutPdf],
      buildFilters(),
      questions,
      preprocessed,
    );

    expect(filtered).toHaveLength(0);
  });

  it("removes has-pdf option from status filter options when PDF feature is disabled", () => {
    expect(getStatusFilterOptionIds(false)).not.toContain("has-pdf");
    expect(getStatusFilterOptionIds(true)).toContain("has-pdf");
  });
});
