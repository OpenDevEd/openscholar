/**
 * @vitest-environment jsdom
 *
 * A results list in the order made for its search's results, and as it was for any other results.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resultsKey, useLikelyOrdered, useLikelyOrderStore } from "@/lib/search/likely-order";

const paper = (n: number) => ({ id: `https://openscholar.ai/OS${n}` });
const results = [1, 2, 3].map(paper);

beforeEach(() => {
  useLikelyOrderStore.setState({ orders: {} });
});

describe("a results list's likely order", () => {
  it("is the order made for the search's results, and the list's own until one is", () => {
    const { result } = renderHook(() => useLikelyOrdered("search-1", results, results, {}));
    expect(result.current.map((one) => one.id)).toEqual(results.map((one) => one.id));
    act(() => useLikelyOrderStore.getState().setOrder("search-1", { key: resultsKey(results), ids: [paper(3).id, paper(1).id, paper(2).id], seeds: { liked: ["OS9"], disliked: [] } }));
    expect(result.current.map((one) => one.id)).toEqual([3, 1, 2].map((n) => paper(n).id));
  });

  it("is the list's own for results the order wasn't made for, or another search's", () => {
    useLikelyOrderStore.getState().setOrder("search-1", { key: resultsKey([paper(1), paper(2)]), ids: [paper(2).id, paper(1).id], seeds: { liked: ["OS9"], disliked: [] } });
    const other = renderHook(() => useLikelyOrdered("search-1", results, results, {}));
    expect(other.result.current.map((one) => one.id)).toEqual(results.map((one) => one.id));
    const elsewhere = renderHook(() => useLikelyOrdered("search-2", [paper(1), paper(2)], [paper(1), paper(2)], {}));
    expect(elsewhere.result.current.map((one) => one.id)).toEqual([paper(1).id, paper(2).id]);
  });
});
