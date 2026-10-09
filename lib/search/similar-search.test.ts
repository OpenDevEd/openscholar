import { beforeEach, describe, expect, it } from "vitest";
import { createCitationSearch } from "./actions";
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
});
