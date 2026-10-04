import { describe, expect, it } from "vitest";
import { trimPaperData } from "./trim-paper-data";
import { authorMetadata, mergePaperMetadata } from "./paper-metadata";

describe("saved paper metadata", () => {
  it("keeps author boundaries and source facts, including zero and false", () => {
    expect(trimPaperData({ id: "W7", authorships: [{ author: { display_name: "Smith, Jr., John" } }, { author: { display_name: "ليلى" } }], cited_by_count: 0, type: "preprint", open_access: { is_oa: false }, primary_location: { pdf_url: "https://example.org/paper.pdf" } })).toMatchObject({ authors: ["Smith, Jr., John", "ليلى"], citedByCount: 0, workType: "preprint", isOpenAccess: false, pdfUrl: "https://example.org/paper.pdf" });
    expect(trimPaperData({ id: "W8" }).isOpenAccess).toBeUndefined();
  });

  it("recovers exact retained names and preserves ambiguous text without splitting it", () => {
    const authors = "Smith, Jr., John, ليلى";
    expect(authorMetadata({ authors })).toEqual({ authorsUnparsed: authors });
    expect(authorMetadata({ authors, paperData: JSON.stringify({ authorships: [{ author: { display_name: "Smith, Jr., John" } }, { author: { display_name: "ليلى" } }] }) })).toEqual({ authors: ["Smith, Jr., John", "ليلى"] });
    expect(authorMetadata({ authors, paperData: JSON.stringify({ authorships: [{ author: { display_name: "Someone else" } }] }) })).toEqual({ authorsUnparsed: authors });
    const many = Array.from({ length: 101 }, (_, i) => `Author ${i}`);
    expect(authorMetadata({ authorsUnparsed: many.join(", "), paperData: JSON.stringify({ authorships: many.map(display_name => ({ author: { display_name } })) }) })).toEqual({ authorsUnparsed: many.join(", ") });
  });

  it("fills absent fields without degrading an existing paper or its raw record", () => {
    expect(mergePaperMetadata({ title: "Saved", authors: "Smith, Jr., John, ليلى" }, { title: "Saved", authors: ["Smith, Jr., John", "ليلى"] })).toMatchObject({ authors: ["Smith, Jr., John", "ليلى"], authorsUnparsed: undefined });
    const result = mergePaperMetadata({ title: "Saved title", abstract: "Saved abstract", authors: ["Smith, John"], citedByCount: 0, isOpenAccess: false, paperData: JSON.stringify({ id: "W7", title: "Saved title", primary_location: { source: { display_name: "Journal" } } }) }, { title: "Later title", abstract: "", authors: [], citedByCount: 99, isOpenAccess: true, doi: "10.1234/test", paperData: JSON.stringify({ id: "W7", primary_location: { pdf_url: "https://example.org/paper.pdf" } }) });
    expect(result).toMatchObject({ title: "Saved title", abstract: "Saved abstract", authors: ["Smith, John"], citedByCount: 0, isOpenAccess: false, doi: "10.1234/test" });
    expect(JSON.parse(result.paperData!)).toEqual({ id: "W7", title: "Saved title", primary_location: { source: { display_name: "Journal" }, pdf_url: "https://example.org/paper.pdf" } });
    expect(mergePaperMetadata({ title: "Saved", authorsUnparsed: "Original uncertain author text" }, { title: "Saved", authors: ["New source name"] })).toMatchObject({ authors: ["New source name"], authorsUnparsed: "Original uncertain author text" });
  });
});
