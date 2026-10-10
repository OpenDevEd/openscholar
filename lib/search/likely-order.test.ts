import { beforeEach, describe, expect, it } from "vitest";
import { inOrder, likelyOrder, MAX_RATED_SEEDS, resultsKey, sameSeeds, seedsOf, useLikelyOrderStore } from "./likely-order";

const paper = (n: number) => ({ id: `https://openscholar.ai/OS${n}` });

describe("the papers a likely order is made by", () => {
  it("are those rated 4 or 5, and those rated 1 or 2, in the list's order, by short id", () => {
    const papers = [1, 2, 3, 4, 5, 6].map(paper);
    const ratings = { [paper(1).id]: 5, [paper(2).id]: 3, [paper(3).id]: 1, [paper(4).id]: 4, [paper(5).id]: 2 };
    expect(seedsOf(papers, ratings)).toEqual({ liked: ["OS1", "OS4"], disliked: ["OS3", "OS5"] });
  });

  it("are a hundred of each at most, the first in the list", () => {
    const papers = Array.from({ length: MAX_RATED_SEEDS + 5 }, (_, at) => paper(at + 1));
    const ratings = Object.fromEntries(papers.map((one) => [one.id, 5]));
    const { liked } = seedsOf(papers, ratings);
    expect([liked.length, liked[0], liked.at(-1)]).toEqual([MAX_RATED_SEEDS, "OS1", `OS${MAX_RATED_SEEDS}`]);
  });

  it("are the same whatever their order, and not when a rating changes", () => {
    expect(sameSeeds({ liked: ["OS1", "OS2"], disliked: [] }, { liked: ["OS2", "OS1"], disliked: [] })).toBe(true);
    expect(sameSeeds({ liked: ["OS1"], disliked: [] }, { liked: ["OS1"], disliked: ["OS3"] })).toBe(false);
    expect(sameSeeds({ liked: ["OS1", "OS1"], disliked: [] }, { liked: ["OS1", "OS2"], disliked: [] })).toBe(false);
  });
});

describe("a search's results in their likely order", () => {
  it("put the papers not rated yet first, the likeliest first, then those rated, as rated when ordered", () => {
    const closest = [4, 1, 3, 2].map((n) => paper(n).id);
    expect(likelyOrder(closest, { [paper(1).id]: 5 })).toEqual([4, 3, 2, 1].map((n) => paper(n).id));
  });

  it("are shown in the order made, then any paper the order lacks, as it was", () => {
    const papers = [1, 2, 3, 4, 5].map(paper);
    const ids = [4, 3, 2, 1].map((n) => paper(n).id);
    expect(inOrder(papers, ids).map((one) => one.id)).toEqual([4, 3, 2, 1, 5].map((n) => paper(n).id));
  });

  it("are kept per search, for the results they were made for, until cleared", () => {
    const store = useLikelyOrderStore.getState();
    const order = { key: resultsKey([paper(1), paper(2)]), ids: [paper(2).id, paper(1).id], seeds: { liked: ["OS1"], disliked: [] }, rated: [paper(1).id] };
    store.setOrder("search-1", order);
    expect(useLikelyOrderStore.getState().orders["search-1"]).toEqual(order);
    expect(order.key).not.toBe(resultsKey([paper(2), paper(1)]));
    useLikelyOrderStore.getState().clearOrder("search-1");
    expect(useLikelyOrderStore.getState().orders["search-1"]).toBeUndefined();
  });

  beforeEach(() => {
    useLikelyOrderStore.setState({ orders: {} });
  });
});
