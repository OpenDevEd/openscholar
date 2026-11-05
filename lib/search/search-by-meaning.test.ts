import { describe, expect, it } from "vitest";
import { buildOpenAlexWorksQuery } from "../openalex/works-query";
import { DEFAULT_SEARCH_PARAMS, parseSearchParamsFromUrl } from "../search-params";
import { buildOpenAlexSourceQuery } from "../evidence-libraries/openalex-source-query";
import { effectiveSort, paramsToSearchResult, searchResultToParams } from "../search-params/converters";

const query = (params: Partial<typeof DEFAULT_SEARCH_PARAMS>) =>
  buildOpenAlexWorksQuery({ ...DEFAULT_SEARCH_PARAMS, ...params } as never, { expand: (text: string) => ({ expandedQuery: text, warnings: [] }) } as never);

describe("a search by meaning", () => {
  it("sends the question as it was written, whatever it holds, without words from a filter", () => {
    const asked = "What helps (rural) teachers stay? AND why*";
    const built = query({ field: "semantic", q: asked, review: true, focus: ["KE"] });
    expect(built).toMatchObject({ semantic: asked });
    expect(built?.search).toBeUndefined();
    expect(built?.filter ?? "").not.toContain("title_and_abstract");
  });

  it("is listed by closeness, but only once there's a question to be close to", () => {
    expect(effectiveSort({ ...DEFAULT_SEARCH_PARAMS, field: "semantic", q: "why", sort: "cited_by_count:desc" })).toBe("relevance_score:desc");
    expect(effectiveSort({ ...DEFAULT_SEARCH_PARAMS, field: "semantic", q: "", sort: "cited_by_count:desc" })).toBe("cited_by_count:desc");
  });
});

describe("a search for similar papers", () => {
  it("names its papers together, and keeps typed words in a filter, since our index takes no search beside them", () => {
    expect(query({ like: ["W1", "OS2"] })).toMatchObject({ similarTo: "W1|OS2" });
    const words = query({ like: ["W1"], q: "kelp", field: "default" });
    expect(words?.search).toBeUndefined();
    expect(words?.filter).toContain("default.search");
    const question = query({ like: ["W1"], q: "why", field: "semantic" });
    expect(question?.semantic).toBeUndefined();
    expect(question?.filter).toContain("title_and_abstract.search:why");
  });

  it("survives saving, and an old link's address reads as the ID", () => {
    const saved = paramsToSearchResult({ ...DEFAULT_SEARCH_PARAMS, like: ["W1", "OS2"] });
    expect(saved.similarTo).toEqual(["W1", "OS2"]);
    expect(searchResultToParams(saved)).toMatchObject({ like: ["W1", "OS2"] });
    expect(parseSearchParamsFromUrl(new URLSearchParams("like=https://openalex.org/W1,OS2")).like).toEqual(["W1", "OS2"]);
    // Kept, so the search refuses it: without it this would be a search of everything.
    expect(parseSearchParamsFromUrl(new URLSearchParams("like=nonsense")).like).toEqual(["nonsense"]);
  });
});

describe("a community source made from one of these searches", () => {
  it("saves a question as its words, since a source asks OpenAlex", () => {
    const saved = buildOpenAlexSourceQuery({ ...DEFAULT_SEARCH_PARAMS, field: "semantic", q: "What helps teachers?" } as never);
    expect(saved?.filter).toContain("title_and_abstract.search:What helps teachers");
    expect(saved).not.toHaveProperty("semantic");
  });

  it("isn't made from similar papers alone, which OpenAlex can't find", () => {
    expect(buildOpenAlexSourceQuery({ ...DEFAULT_SEARCH_PARAMS, like: ["W1"] } as never)).toBeNull();
  });
});
