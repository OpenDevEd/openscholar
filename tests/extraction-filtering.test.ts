import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_EXTRACTION_PDF_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

async function loadFilteringModule() {
  vi.resetModules();
  return import("../lib/extraction/filtering");
}

async function loadStatusFilterOptionsModule() {
  vi.resetModules();
  return import("../lib/extraction/status-filter-options");
}

afterEach(() => {
  if (ORIGINAL_EXTRACTION_PDF_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_EXTRACTION_PDF_FLAG;
  }
});

describe("extraction result filtering with PDF flag", () => {
  const paperWithoutPdf = {
    _id: "paper_1",
    title: "Abstract-only paper",
    results: [],
    pdfUrl: undefined,
    storageId: undefined,
    pdfContentUsed: false,
    isOpenAccess: false,
    status: "completed",
  } as any;

  const questions: any[] = [];

  function buildFilters() {
    return {
      searchQuery: "",
      confidenceRange: [0, 100] as [number, number],
      statusFilters: new Set(["has-pdf"]),
      questionFilters: new Map(),
    };
  }

  it("applies has-pdf filter when PDF feature is enabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const filtering = await loadFilteringModule();
    const preprocessed = filtering.preprocessPapers([paperWithoutPdf]);

    const filtered = filtering.filterPapers(
      [paperWithoutPdf],
      buildFilters(),
      questions,
      preprocessed
    );

    expect(filtered).toHaveLength(0);
  });

  it("ignores has-pdf filter when PDF feature is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
    const filtering = await loadFilteringModule();
    const preprocessed = filtering.preprocessPapers([paperWithoutPdf]);

    const filtered = filtering.filterPapers(
      [paperWithoutPdf],
      buildFilters(),
      questions,
      preprocessed
    );

    expect(filtered).toHaveLength(1);
  });

  it("removes has-pdf option from status filter options when PDF feature is disabled", async () => {
    const { getStatusFilterOptionIds } = await loadStatusFilterOptionsModule();
    expect(getStatusFilterOptionIds(false)).not.toContain("has-pdf");
    expect(getStatusFilterOptionIds(true)).toContain("has-pdf");
  });
});
