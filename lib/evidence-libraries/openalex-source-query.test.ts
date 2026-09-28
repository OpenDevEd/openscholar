import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/actions/openalex", () => ({ getSearchResults: vi.fn() }));
import { DEFAULT_SEARCH_PARAMS, buildResultsUrl } from "@/lib/search-params";
import { readDraft, changedSectionRows } from "./configuration/rules";
import { approveOpenAlexQuery, type OpenAlexSourceEntry } from "./configuration/sources";
import { validateSectionStructure } from "./configuration/generated-validation";
import { buildOpenAlexSourceQuery, openAlexSourceSearchUrl, readOpenAlexSourceSearch, sameOpenAlexSourceSearch, sourceSearchHistoryId } from "./openalex-source-query";

const params = {
  ...DEFAULT_SEARCH_PARAMS, q: "education", ft: "date", df: "2020-03-15", dt: "2025-06-30", reg: ["GB"], focus: ["KE"],
  review: true, cites: "W123", citedBy: "W456", rel: "W789",
  area: ["subfields/3304", "T10001"], sdg: ["4"], oa: true, type: ["article"],
  wlang: ["en"], itype: ["government"], funder: ["F4320311904"], mincite: 5, abs: true,
};

describe("saved source search", () => {
  it("approves every filter the search page has", () => {
    const query = buildOpenAlexSourceQuery(params);
    expect(query?.filter).toContain('title_and_abstract.search:((education) AND ("Kenya")) AND (review OR synthesis OR "meta-analysis")');
    expect(query?.filter).toContain("from_publication_date:2020-03-15,to_publication_date:2025-06-30");
    expect(query?.filter).toContain("authorships.countries:GB");
    expect(query?.filter).toContain("cites:https://openalex.org/W123,cited_by:https://openalex.org/W456,related_to:https://openalex.org/W789");
    expect(query?.filter).toContain("topics.subfield.id:3304,topics.id:T10001");
    expect(query?.filter).toContain("sustainable_development_goals.id:https://metadata.un.org/sdg/4");
    expect(query?.filter).toContain("open_access.is_oa:true");
    expect(query?.filter).toContain("type:article");
    expect(query?.filter).toContain("language:en");
    expect(query?.filter).toContain("authorships.institutions.type:government");
    expect(query?.filter).toContain("funders.id:F4320311904");
    expect(query?.filter).toContain("cited_by_count:>4");
    expect(query?.filter).toContain("has_abstract:true");
    expect(query?.filter).toContain("is_retracted:false");
  });

  it("reopens with every control after the configuration is saved", () => {
    const source: OpenAlexSourceEntry = {
      key: "openalex-education", provider: "openalex", enabled: true, writebackEnabled: false,
      settings: { name: "Education", downloadPdfs: false, apiKeyMode: "platform", searchUrl: buildResultsUrl("saved-search-1", params), approvedQuery: approveOpenAlexQuery(undefined, buildOpenAlexSourceQuery(params)!) },
    };
    const draft = readDraft([{ sectionKey: "sources", payload: [source] }]);
    const reopened = readDraft(changedSectionRows(draft, [])).sources[0] as OpenAlexSourceEntry;
    expect(reopened.settings.approvedQuery).toEqual(source.settings.approvedQuery);
    expect(sourceSearchHistoryId(reopened)).toBe("saved-search-1");
    expect(readOpenAlexSourceSearch(reopened)).toMatchObject(params);
    expect(sameOpenAlexSourceSearch(params, {...params, page: 2, sort: "publication_date:desc"})).toBe(true);
    expect(sameOpenAlexSourceSearch(params, {...params, type: []})).toBe(false);
  });

  it("supports filter-only searches and blocks an empty import", () => {
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, area: ["T10001"]})).toEqual({filter: "topics.id:T10001,is_retracted:false"});
    // Leaving out retracted works narrows nothing, so it cannot make an empty search importable.
    expect(buildOpenAlexSourceQuery(DEFAULT_SEARCH_PARAMS)).toBeNull();
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, retracted: true})).toBeNull();
  });

  it("keeps literal punctuation in a quoted query", () => {
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, q: '"C++ & education,example: value #1"'}))
      .toEqual({filter: 'title_and_abstract.search:"C++ & education,example: value #1",is_retracted:false'});
  });

  it("imports an OQL search and reopens it with the typed query", () => {
    const oqlParams = {...DEFAULT_SEARCH_PARAMS, field: "oql", q: "title has (chatgpt) and title has (education)", type: ["article"]};
    const query = buildOpenAlexSourceQuery(oqlParams)!;
    expect(query).toEqual({oql: "works where (title has (chatgpt) and title has (education)) and type is (article) and is_retracted is (false)"});
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, field: "oql"})).toBeNull();
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, field: "oql", q: "(IS_RETRACTED is (false))"})).toBeNull();
    expect(buildOpenAlexSourceQuery({...DEFAULT_SEARCH_PARAMS, field: "oql", q: "is_retracted is (false) or retracted is (false)"})).toBeNull();

    const source: OpenAlexSourceEntry = {
      key: "openalex-aied", provider: "openalex", enabled: true, writebackEnabled: false,
      settings: { name: "AIED", downloadPdfs: false, apiKeyMode: "platform", searchUrl: openAlexSourceSearchUrl("saved-search-2", oqlParams), approvedQuery: approveOpenAlexQuery(undefined, query) },
    };
    const reopened = readDraft(changedSectionRows(readDraft([{ sectionKey: "sources", payload: [source] }]), [])).sources[0] as OpenAlexSourceEntry;
    expect(reopened.settings.approvedQuery.query).toEqual(query);
    expect(readOpenAlexSourceSearch(reopened)).toMatchObject(oqlParams);
    // The runtime's configuration contract, synced from new-el, accepts its settings.
    // (The API key is a separate credential this entry does not carry.)
    const issues = validateSectionStructure("sources", [source]).issues;
    expect(issues.filter((issue) => issue.pointer.startsWith("/sources/0/settings"))).toEqual([]);
  });
});
