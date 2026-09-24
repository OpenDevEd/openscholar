import { describe, expect, it } from "vitest";
import {
  buildOpenAlexSourceQuery,
  parseOpenAlexSourceQuery,
} from "./openalex-source-query";

describe("OpenAlex source query builder", () => {
  it("turns structured selections into the approved OpenAlex request", () => {
    const query = buildOpenAlexSourceQuery({
      search: "teacher education",
      scope: "title_and_abstract",
      yearRange: [2020, 2026],
      locations: ["MA", "GB"],
      types: ["article", "report"],
      topicLevel: "subfield",
      topicIds: ["3304", "3309"],
      sdgs: ["4", "10"],
      openAccessOnly: true,
    });

    expect(query).toEqual({
      filter:
        "title_and_abstract.search:teacher education,publication_year:2020-2026,authorships.countries:GB|MA,type:article|report,topics.subfield.id:3304|3309,sustainable_development_goals.id:https://metadata.un.org/sdg/4|https://metadata.un.org/sdg/10,open_access.is_oa:true",
    });
  });

  it("round trips the canonical request used to edit an approved source", () => {
    const approved = {
      search: "education policy",
      filter:
        "publication_year:2018-2025,authorships.countries:DE|FR,type:article,topics.id:T100|T200,open_access.is_oa:true",
    };

    expect(
      buildOpenAlexSourceQuery(parseOpenAlexSourceQuery(approved)),
    ).toEqual(approved);
  });

  it("uses the exact scoped search field for an unquoted wildcard", () => {
    expect(
      buildOpenAlexSourceQuery({
        search: "teach*",
        scope: "title",
        yearRange: null,
        locations: [],
        types: [],
        topicLevel: "topic",
        topicIds: [],
        sdgs: [],
        openAccessOnly: false,
      }),
    ).toEqual({ filter: "title.search.exact:teach*" });
  });
});
