import { describe, expect, it } from "vitest";
import {
  getStructuredCitations,
  getCitationStatus,
  getPrimaryCitation,
  getAllCitationLocations,
} from "../lib/extraction/citations";

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
  it("returns empty array for null result", () => {
    expect(getStructuredCitations(null)).toEqual([]);
  });

  it("returns empty array for undefined result", () => {
    expect(getStructuredCitations(undefined)).toEqual([]);
  });

  it("returns empty array when citations is not an array", () => {
    expect(getStructuredCitations({ citations: "not an array" as unknown as unknown[] })).toEqual([]);
    expect(getStructuredCitations({ citations: 42 as unknown as unknown[] })).toEqual([]);
    expect(getStructuredCitations({})).toEqual([]);
  });

  it("returns valid CitationEvidence for correct citation object", () => {
    const result = getStructuredCitations(validResult);
    expect(result).toHaveLength(1);
    expect(result[0].evidenceId).toBe("ev_1");
    expect(result[0].page).toBe(5);
    expect(result[0].charRange).toEqual([10, 50]);
    expect(result[0].quote).toBe("This is evidence text");
    expect(result[0].validated).toBe(true);
    expect(result[0].retrieval.denseScore).toBe(0.85);
  });

  it("filters out citations with empty evidenceId", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, evidenceId: "" }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations where end < start in charRange", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, charRange: [50, 10] }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations where validated is not true", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, validated: false }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations with empty quote", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, quote: "" }],
    });
    expect(result).toEqual([]);
  });

  it("filters out citations with non-finite page", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, page: NaN }],
    });
    expect(result).toEqual([]);
  });

  it("handles retrieval with no scores (empty object)", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, retrieval: {} }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].retrieval).toEqual({});
  });

  it("handles missing retrieval field", () => {
    const result = getStructuredCitations({
      citations: [{ ...validCitation, retrieval: undefined }],
    });
    expect(result).toHaveLength(1);
  });

  it("keeps valid citations and filters invalid ones from mixed array", () => {
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
    (status) => {
      expect(getCitationStatus({ citationStatus: status })).toBe(status);
    }
  );

  it("returns undefined for invalid status", () => {
    expect(getCitationStatus({ citationStatus: "unknown_status" })).toBeUndefined();
  });

  it("returns undefined for missing citationStatus", () => {
    expect(getCitationStatus({})).toBeUndefined();
  });

  it("returns undefined for null result", () => {
    expect(getCitationStatus(null)).toBeUndefined();
  });
});

describe("getPrimaryCitation - pdfEnabled gating", () => {
  it("returns null when pdfEnabled is false", () => {
    expect(getPrimaryCitation(validResult, false)).toBeNull();
  });

  it("returns first citation as CitationLocation when pdfEnabled is true", () => {
    const primary = getPrimaryCitation(validResult, true);
    expect(primary).not.toBeNull();
    expect(primary!.evidenceId).toBe("ev_1");
    expect(primary!.text).toBe("This is evidence text");
    expect(primary!.citationStatus).toBe("grounded");
    expect(primary!.validated).toBe(true);
  });

  it("defaults pdfEnabled to true when omitted", () => {
    const primary = getPrimaryCitation(validResult);
    expect(primary).not.toBeNull();
    expect(primary!.evidenceId).toBe("ev_1");
  });

  it("returns null when no valid citations exist", () => {
    expect(getPrimaryCitation({ citations: [] })).toBeNull();
  });

  it("returns null for null result", () => {
    expect(getPrimaryCitation(null)).toBeNull();
  });
});

describe("getAllCitationLocations - pdfEnabled gating", () => {
  it("returns empty array when pdfEnabled is false", () => {
    expect(getAllCitationLocations(validResult, false)).toEqual([]);
  });

  it("returns all citations as CitationLocation array when pdfEnabled is true", () => {
    const multiResult = {
      citations: [
        validCitation,
        { ...validCitation, evidenceId: "ev_2", page: 10, quote: "Second evidence" },
      ],
      citationStatus: "best_effort",
    };
    const locations = getAllCitationLocations(multiResult, true);
    expect(locations).toHaveLength(2);
    expect(locations[0].text).toBe("This is evidence text");
    expect(locations[1].text).toBe("Second evidence");
    expect(locations[0].citationStatus).toBe("best_effort");
    expect(locations[1].citationStatus).toBe("best_effort");
  });

  it("defaults pdfEnabled to true when omitted", () => {
    const locations = getAllCitationLocations(validResult);
    expect(locations).toHaveLength(1);
  });

  it("returns empty array for result with no citations", () => {
    expect(getAllCitationLocations({ citations: [] })).toEqual([]);
  });
});
