import { describe, expect, it } from "vitest";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";
import { worksOql } from "./oql";

const filters: SearchFilters = {
  searchField: "oql",
  sortBy: "relevance_score:desc",
  filterType: "year",
  yearRange: [2020, 2024],
  isYearRangeEnabled: true,
  selectedRegions: [],
  selectedCountryFocus: [],
  citesItemId: "W2741809807",
  citedByItemId: "",
  relatedToItemId: "",
  reviewFilter: false,
  researchAreas: ["T14414", "T11902", "subfields/3304"],
  sdgs: ["4"],
  openAccessOnly: true,
  workTypes: ["article", "review"],
  workLanguages: ["en"],
  institutionTypes: ["education"],
  funders: ["F4320332161"],
  authors: ["A5023888391", "Open Development & Education"],
  minCitations: 10,
  hasAbstract: true,
  includeRetracted: false,
};

// Every clause form below was run against api.openalex.org and matched the classic filter's count.
describe("worksOql", () => {
  it("writes each sidebar filter as an OQL clause OpenAlex accepts", () => {
    const { filter } = createSearchParameters("title/abstract has (chatgpt)", filters);
    expect(worksOql("works where title/abstract has (chatgpt)", filter).split(" and ")).toEqual([
      "works where (title/abstract has (chatgpt))",
      "cites is (https://openalex.org/W2741809807)",
      "from_publication_date is (2020-01-01)",
      "to_publication_date is (2024-12-31)",
      "topics.id is (T14414 or T11902)",
      "topics.subfield.id is (3304)",
      "sustainable_development_goals.id is (4)",
      "open_access.is_oa is (true)",
      "type is (article or review)",
      "language is (en)",
      "authorships.institutions.type is (education)",
      "authorships.author.id is (A5023888391)",
      "funders.id is (F4320332161)",
      'raw_author_name.search has ("Open Development & Education")',
      "cited_by_count > (9)",
      "has_abstract is (true)",
      "is_retracted is (false)",
    ]);
  });

  it("runs filters alone when the query box is empty or says only works", () => {
    expect(worksOql("  ", { type: "article" })).toBe("works where type is (article)");
    expect(worksOql("works", { type: "article" })).toBe("works where type is (article)");
    expect(worksOql("")).toBe("works");
  });

  it("keeps a typed sample after the added filters", () => {
    expect(worksOql("works where year is (2020) sample 50 seed 7", { type: "article" })).toBe(
      "works where (year is (2020)) and type is (article) sample 50 seed 7",
    );
  });
});
