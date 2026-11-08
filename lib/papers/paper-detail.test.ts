import { describe, expect, it } from "vitest";
import { paperDetail } from "./paper-detail";
import type { PaperResult } from "@/lib/types/search.types";

const work = (fields: Record<string, unknown>) => ({ id: "https://openalex.org/W1", title: "A paper", ...fields }) as unknown as PaperResult;

describe("a paper page's view of both records", () => {
  it("takes authors' institutions from OpenAlex when our index has none, and keeps our influence counts", () => {
    const ours = work({ authorships: [{ author: { display_name: "A. Author" }, institutions: [] }], influential_citation_count: 7, publication_year: 2021 });
    const theirs = work({ authorships: [{ author: { display_name: "Ann Author", orcid: "https://orcid.org/0000-0001" }, institutions: [{ display_name: "Uni &amp; College", country_code: "GB" }], is_corresponding: true }] });
    const detail = paperDetail(ours, theirs, "OS1", 2026);
    expect(detail.authors).toEqual([{ name: "Ann Author", orcid: "https://orcid.org/0000-0001", corresponding: true, institutions: [{ name: "Uni & College", country: "GB" }] }]);
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
