import { describe, it, expect } from "vitest";
import { mapOpenAlexWorkToPaperData } from "../lib/openalex/work-mapper";

/**
 * Pure tests for mapOpenAlexWorkToPaperData — the work-to-PaperData
 * mapper lifted out of convex/extraction/actions.ts. No fetch, no env.
 */

describe("mapOpenAlexWorkToPaperData — id + title", () => {
  it("strips the https://openalex.org/ prefix from the id", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1234",
      display_name: "Title",
    });
    expect(paper.openalexId).toBe("W1234");
  });

  it("falls back to empty string when id is missing", () => {
    const paper = mapOpenAlexWorkToPaperData({ display_name: "Title" });
    expect(paper.openalexId).toBe("");
  });

  it("falls back to 'Untitled' when display_name is missing", () => {
    const paper = mapOpenAlexWorkToPaperData({ id: "https://openalex.org/W1" });
    expect(paper.title).toBe("Untitled");
  });
});

describe("mapOpenAlexWorkToPaperData — abstract reconstruction", () => {
  it("reconstructs the abstract from an inverted index", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
      abstract_inverted_index: {
        Hello: [0],
        world: [1],
      },
    });
    expect(paper.abstract).toBe("Hello world");
  });

  it("leaves abstract undefined when no inverted index is present", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
    });
    expect(paper.abstract).toBeUndefined();
  });
});

describe("mapOpenAlexWorkToPaperData — authors", () => {
  it("extracts author display names from authorships", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
      authorships: [
        { author: { display_name: "Ada Lovelace" } },
        { author: { display_name: "Alan Turing" } },
      ],
    });
    expect(paper.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
  });

  it("filters out authorships with missing display_name", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
      authorships: [
        { author: { display_name: "A" } },
        { author: {} },
        {},
        { author: { display_name: "B" } },
      ],
    });
    expect(paper.authors).toEqual(["A", "B"]);
  });

  it("returns empty array when authorships is missing", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
    });
    expect(paper.authors).toEqual([]);
  });
});

describe("mapOpenAlexWorkToPaperData — open access", () => {
  it("extracts pdfUrl from open_access.oa_url", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
      open_access: { oa_url: "https://example.com/paper.pdf", is_oa: true },
    });
    expect(paper.pdfUrl).toBe("https://example.com/paper.pdf");
    expect(paper.isOpenAccess).toBe(true);
  });

  it("defaults isOpenAccess to false when missing", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
    });
    expect(paper.isOpenAccess).toBe(false);
    expect(paper.pdfUrl).toBeUndefined();
  });
});

describe("mapOpenAlexWorkToPaperData — simple passthrough fields", () => {
  it("passes doi and publicationYear through when present", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
      doi: "https://doi.org/10.1234/abc",
      publication_year: 2024,
    });
    expect(paper.doi).toBe("https://doi.org/10.1234/abc");
    expect(paper.publicationYear).toBe(2024);
  });

  it("leaves doi and publicationYear undefined when missing", () => {
    const paper = mapOpenAlexWorkToPaperData({
      id: "https://openalex.org/W1",
      display_name: "T",
    });
    expect(paper.doi).toBeUndefined();
    expect(paper.publicationYear).toBeUndefined();
  });
});
