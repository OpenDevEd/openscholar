import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/actions/openalex", () => ({ getSearchResults: vi.fn() }));
import { DEFAULT_SEARCH_PARAMS, buildResultsUrl } from "@/lib/search-params";
import { EMPTY_IMPORT_EXTRAS } from "./openalex-import-request";
import { readDraft, changedSectionRows } from "./configuration/rules";
import { approveOpenAlexQuery, type OpenAlexSourceEntry } from "./configuration/sources";
import { buildOpenAlexSourceQuery, parseOpenAlexSourceQuery, readOpenAlexSourceSearch, sameOpenAlexSourceSearch, sourceSearchHistoryId } from "./openalex-source-query";

const extras = { ...EMPTY_IMPORT_EXTRAS, topicIds: ["3304"], sdgs: ["4"], openAccessOnly: true };
const params = { ...DEFAULT_SEARCH_PARAMS, q: "education", ft: "date", df: "2020-03-15", dt: "2025-06-30", reg: ["GB"], focus: ["KE"], review: true, cites: "W123", citedBy: "W456", rel: "W789" };

describe("saved source search workspace", () => {
  it("approves the full search filters, including country focus and review expansion", () => {
    const query = buildOpenAlexSourceQuery({ params, extras });
    expect(query?.filter).toContain('title_and_abstract.search:((education) AND ("Kenya")) AND (review OR synthesis OR "meta-analysis")');
    expect(query?.filter).toContain("from_publication_date:2020-03-15,to_publication_date:2025-06-30");
    expect(query?.filter).toContain("authorships.countries:GB");
    expect(query?.filter).toContain("cites:https://openalex.org/W123,cited_by:https://openalex.org/W456,related_to:https://openalex.org/W789");
    expect(query?.filter).toContain("topics.subfield.id:3304,sustainable_development_goals.id:https://metadata.un.org/sdg/4,open_access.is_oa:true");
  });

  it("keeps original controls and history when configuration is saved and reopened", () => {
    const source: OpenAlexSourceEntry = {
      key: "openalex-education", provider: "openalex", enabled: true, writebackEnabled: false,
      settings: { name: "Education", downloadPdfs: false, apiKeyMode: "platform", searchUrl: buildResultsUrl("saved-search-1", params), approvedQuery: approveOpenAlexQuery(undefined, buildOpenAlexSourceQuery({params, extras})!) },
    };
    const draft = readDraft([{ sectionKey: "sources", payload: [source] }]);
    const savedRows = changedSectionRows(draft, []);
    const reopened = readDraft(savedRows).sources[0] as OpenAlexSourceEntry;
    expect(reopened.settings.approvedQuery).toEqual(source.settings.approvedQuery);
    expect(sourceSearchHistoryId(reopened)).toBe("saved-search-1");
    expect(readOpenAlexSourceSearch(reopened)).toMatchObject({params, extras});
    expect(sameOpenAlexSourceSearch({params, extras}, {params: {...params, page: 2, sort: "publication_date:desc"}, extras})).toBe(true);
    expect(sameOpenAlexSourceSearch({params, extras}, {params: {...params, focus: []}, extras})).toBe(false);
  });

  it("supports filter-only searches and blocks an empty import", () => {
    expect(buildOpenAlexSourceQuery({params: DEFAULT_SEARCH_PARAMS, extras: {...EMPTY_IMPORT_EXTRAS, topicLevel: "topic", topicIds: ["T10001"]}})).toEqual({filter: "topics.id:T10001"});
    expect(buildOpenAlexSourceQuery({params: DEFAULT_SEARCH_PARAMS, extras: EMPTY_IMPORT_EXTRAS})).toBeNull();
  });

  it("retains provider-only criteria when another source filter changes", () => {
    const parsed = parseOpenAlexSourceQuery({filter: 'title.search:education,type:article,publication_year:2020-2025,topics.id:T10001'});
    expect(buildOpenAlexSourceQuery({...parsed, params: {...parsed.params, reg: ["KE"]}})).toEqual({filter: 'title.search:education,from_publication_date:2020-01-01,to_publication_date:2025-12-31,authorships.countries:KE,type:article,topics.id:T10001'});
  });

  it("preserves literal URL punctuation and quoted filter-like text in a query", () => {
    const query = { params: {...DEFAULT_SEARCH_PARAMS, q: '\"C++ & education,example: value #1\"'}, extras: EMPTY_IMPORT_EXTRAS };
    const approved = buildOpenAlexSourceQuery(query)!;
    expect(approved).toEqual({filter: 'title_and_abstract.search:\"C++ & education,example: value #1\"'});
    expect(parseOpenAlexSourceQuery(approved).params.q).toBe(query.params.q);
  });
});
