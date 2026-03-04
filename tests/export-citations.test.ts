import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PDF_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

async function loadCitationsModule() {
  vi.resetModules();
  return import("../lib/extraction/citations");
}

afterEach(() => {
  if (ORIGINAL_PDF_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_PDF_FLAG;
  }
});

const validCitation = {
  evidenceId: "ev_1",
  page: 5,
  charRange: [10, 50],
  quote: "This is evidence text",
  retrieval: { denseScore: 0.85, rerankScore: 0.92 },
  validated: true,
};

const validResult = {
  citations: [validCitation],
  citationStatus: "grounded",
};

describe("getStructuredCitations", () => {
  it("returns empty array for null result", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    expect(getStructuredCitations(null)).toEqual([]);
  });

  it("returns empty array for undefined result", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    expect(getStructuredCitations(undefined)).toEqual([]);
  });

  it("returns empty array when citations is not an array", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    expect(getStructuredCitations({ citations: "not an array" as unknown as unknown[] })).toEqual([]);
    expect(getStructuredCitations({ citations: 42 as unknown as unknown[] })).toEqual([]);
    expect(getStructuredCitations({})).toEqual([]);
  });

  it("returns valid CitationEvidence for correct citation object", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations(validResult);
    expect(result).toHaveLength(1);
    expect(result[0].evidenceId).toBe("ev_1");
    expect(result[0].page).toBe(5);
    expect(result[0].charRange).toEqual([10, 50]);
    expect(result[0].quote).toBe("This is evidence text");
    expect(result[0].validated).toBe(true);
    expect(result[0].retrieval.denseScore).toBe(0.85);
  });

  it("filters out citations with empty evidenceId", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, evidenceId: "" }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations where end < start in charRange", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, charRange: [50, 10] }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations where validated is not true", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, validated: false }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations with empty quote", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, quote: "" }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations with non-finite page", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, page: NaN }],
    });
    expect(result).toEqual([]);
  });

  it("handles retrieval with no scores (empty object)", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, retrieval: {} }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].retrieval).toEqual({});
  });

  it("handles missing retrieval field", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [{ ...validCitation, retrieval: undefined }],
    });
    expect(result).toHaveLength(1);
  });

  it("keeps valid citations and filters invalid ones from mixed array", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getStructuredCitations } = await loadCitationsModule();
    const result = getStructuredCitations({
      citations: [
        validCitation,
        { ...validCitation, evidenceId: "" }, // invalid
        { ...validCitation, evidenceId: "ev_2", page: 10 }, // valid
      ],
    });
    expect(result).toHaveLength(2);
  });
});

describe("getCitationStatus", () => {
  it.each([
    "grounded",
    "best_effort",
    "insufficient_evidence",
    "extraction_error",
  ] as const)(
    'returns "%s" for result with that citationStatus',
    async (status) => {
      process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
      const { getCitationStatus } = await loadCitationsModule();
      expect(getCitationStatus({ citationStatus: status })).toBe(status);
    }
  );

  it("returns undefined for invalid status", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getCitationStatus } = await loadCitationsModule();
    expect(getCitationStatus({ citationStatus: "unknown_status" })).toBeUndefined();
  });

  it("returns undefined for missing citationStatus", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getCitationStatus } = await loadCitationsModule();
    expect(getCitationStatus({})).toBeUndefined();
  });

  it("returns undefined for null result", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getCitationStatus } = await loadCitationsModule();
    expect(getCitationStatus(null)).toBeUndefined();
  });
});

describe("getPrimaryCitation - PDF flag gating", () => {
  it("returns null when PDF feature flag is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
    const { getPrimaryCitation } = await loadCitationsModule();
    expect(getPrimaryCitation(validResult)).toBeNull();
  });

  it("returns first citation as CitationLocation when PDF enabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getPrimaryCitation } = await loadCitationsModule();
    const primary = getPrimaryCitation(validResult);
    expect(primary).not.toBeNull();
    expect(primary!.evidenceId).toBe("ev_1");
    expect(primary!.text).toBe("This is evidence text");
    expect(primary!.citationStatus).toBe("grounded");
    expect(primary!.validated).toBe(true);
  });

  it("returns null when no valid citations exist (PDF enabled)", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getPrimaryCitation } = await loadCitationsModule();
    expect(getPrimaryCitation({ citations: [] })).toBeNull();
  });

  it("returns null for null result (PDF enabled)", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getPrimaryCitation } = await loadCitationsModule();
    expect(getPrimaryCitation(null)).toBeNull();
  });
});

describe("getAllCitationLocations - PDF flag gating", () => {
  it("returns empty array when PDF feature flag is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
    const { getAllCitationLocations } = await loadCitationsModule();
    expect(getAllCitationLocations(validResult)).toEqual([]);
  });

  it("returns all citations as CitationLocation array when PDF enabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getAllCitationLocations } = await loadCitationsModule();
    const multiResult = {
      citations: [
        validCitation,
        { ...validCitation, evidenceId: "ev_2", page: 10, quote: "Second evidence" },
      ],
      citationStatus: "best_effort",
    };
    const locations = getAllCitationLocations(multiResult);
    expect(locations).toHaveLength(2);
    expect(locations[0].text).toBe("This is evidence text");
    expect(locations[1].text).toBe("Second evidence");
    expect(locations[0].citationStatus).toBe("best_effort");
    expect(locations[1].citationStatus).toBe("best_effort");
  });

  it("returns empty array for result with no citations (PDF enabled)", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { getAllCitationLocations } = await loadCitationsModule();
    expect(getAllCitationLocations({ citations: [] })).toEqual([]);
  });
});
