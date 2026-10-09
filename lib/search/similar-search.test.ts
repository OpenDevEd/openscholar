import { beforeEach, describe, expect, it } from "vitest";
import { createCitationSearch, createSimilarSearch, MAX_SIMILAR_PAPERS } from "./actions";
import { localSearchHistoryStore } from "../store";

describe("a paper's similar papers", () => {
  beforeEach(() => {
    localSearchHistoryStore.setState({ searchHistory: [] });
  });

  it("start a search for the works nearest the paper, by its short id, closest first", () => {
    const { id, url } = createCitationSearch("https://openscholar.ai/OS64233829", "similar", "semantic");
    expect(new URL(url, "https://openscholar.test").searchParams.get("like")).toBe("OS64233829");
    const saved = localSearchHistoryStore.getState().searchHistory.find((search) => search.id === id);
    expect(saved).toMatchObject({ similarTo: ["OS64233829"], field: "title_and_abstract", sortBy: "relevance_score:desc", relatedToItemId: "" });
  });

  it("start one search for the works nearest several papers, each once, at most a hundred", () => {
    const { url } = createSimilarSearch(["https://openscholar.ai/OS1", "OS2", "https://openscholar.ai/OS1", "W2741809807"]);
    expect(new URL(url, "https://openscholar.test").searchParams.get("like")).toBe("OS1,OS2,W2741809807");
    const many = Array.from({ length: MAX_SIMILAR_PAPERS + 5 }, (_, at) => `OS${at + 1}`);
    const { id } = createSimilarSearch(many);
    const saved = localSearchHistoryStore.getState().searchHistory.find((search) => search.id === id);
    expect(saved?.similarTo).toHaveLength(MAX_SIMILAR_PAPERS);
  });
});

