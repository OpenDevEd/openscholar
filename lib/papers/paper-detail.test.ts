import { describe, expect, it } from "vitest";
import { paperDetail } from "./paper-detail";
import type { PaperResult } from "@/lib/types/search.types";

const work = (fields: Record<string, unknown>) => ({ id: "https://openalex.org/W1", title: "A paper", ...fields }) as unknown as PaperResult;

describe("a paper page's view of both records", () => {
  it("shows each author once when OpenAlex lists one twice", () => {
    const theirs = work({ authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Daler Bokiev" } }, { author: { id: "https://openalex.org/A2", display_name: "Ann Author" } }, { author: { id: "https://openalex.org/A1", display_name: "Daler Bokiev" } }] });
    expect(paperDetail(work({}), theirs, "OS1", 2026).authors.map((author) => author.name)).toEqual(["Daler Bokiev", "Ann Author"]);
  });

  it("takes authors' institutions from OpenAlex when our index has none, with their ROR IDs, and keeps our influence counts", () => {
    const ours = work({ authorships: [{ author: { display_name: "A. Author" }, institutions: [] }], influential_citation_count: 7, publication_year: 2021 });
    const theirs = work({ authorships: [{ author: { id: "https://openalex.org/A9", display_name: "Ann Author", orcid: "https://orcid.org/0000-0001" }, institutions: [{ id: "https://openalex.org/I7", display_name: "Uni &amp; College", country_code: "GB", ror: "https://ror.org/013meh722" }, { id: "https://openalex.org/I8", display_name: "Lab", ror: "ror.org/013meh722" }], is_corresponding: true }] });
    const detail = paperDetail(ours, theirs, "OS1", 2026);
    expect(detail.authors).toEqual([{ id: "A9", name: "Ann Author", orcid: "https://orcid.org/0000-0001", corresponding: true, institutions: [{ id: "I7", name: "Uni & College", country: "GB", ror: "https://ror.org/013meh722" }, { id: "I8", name: "Lab", country: null, ror: null }] }]);
    expect(detail.influentialCitations).toBe(7);
  });

  it("lists only real places to read, and fills the years no one cited it", () => {
    const ours = work({
      publication_year: 2021,
      locations: [{ landing_page_url: "https://www.semanticscholar.org/paper/abc", source: { display_name: "NeurIPS", type: "conference" } }],
      counts_by_year: [{ year: 2024, cited_by_count: 5 }, { year: 2022, cited_by_count: 2 }],
    });
    const detail = paperDetail(ours, null, "OS1", 2026);
    expect(detail.copies).toEqual([]);
    expect(detail.citationsByYear).toEqual([{ year: 2022, count: 2 }, { year: 2023, count: 0 }, { year: 2024, count: 5 }]);
  });
});

describe("what one source has and the other lacks", () => {
  it("keeps our PDF when OpenAlex only knows the landing page, and falls back to OpenAlex's abstract", () => {
    const ours = work({ abstract: null, cited_by_count: 11, locations: [{ pdf_url: "https://cochrane.org/a.pdf", source: null }], primary_location: { source: { id: "https://openscholar.ai/OSV1", display_name: "Our Journal" } }, publication_year: 2020 });
    const theirs = work({ abstract: "What it found.", primary_location: { source: null }, cited_by_count: 19, counts_by_year: [{ year: 2021, cited_by_count: 19 }], locations: [{ landing_page_url: "https://doi.org/10.1/x", source: { display_name: "Journal", type: "journal" } }] });
    const detail = paperDetail(ours, theirs, "OS1", 2026);
    expect(detail.copies.map((copy) => [copy.name, copy.pdf])).toEqual([["Journal", false], ["cochrane.org", true]]);
    expect(detail.abstract).toBe("What it found.");
    expect(detail.citations).toBe(19);
    expect(detail.journal).toEqual({ id: "OSV1", name: "Our Journal" });
  });
});
