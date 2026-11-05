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
  journals: ["S137773608"],
  institutions: ["I136199984"],
  studyDesigns: ["randomized-controlled-trial"],
  topCitedOnly: true,
  venuesOnly: true,
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
      "authorships.institutions.lineage is (I136199984)",
      "authorships.author.id is (A5023888391)",
      "funders.id is (F4320332161)",
      'raw_author_name.search has ("Open Development & Education")',
      "primary_location.source.id is (S137773608)",
      'primary_location.source.type is (journal or conference or "book series")',
      "study_designs.id is (study-designs/randomized-controlled-trial or study-designs/clinical-trial)",
      "citation_normalized_percentile.is_in_top_10_percent is (true)",
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

  it("takes the general form's get works where, so filters join it", () => {
    expect(worksOql("get works where year is (2024)", { type: "article" })).toBe("works where (year is (2024)) and type is (article)");
    expect(worksOql("get works", { type: "article" })).toBe("works where type is (article)");
    // A sentence stays whole, for the search to say how to write it.
    expect(worksOql("get works about kelp", { type: "article" })).toBe("works where (get works about kelp) and type is (article)");
  });
});
