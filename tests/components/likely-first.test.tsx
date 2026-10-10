/**
 * @vitest-environment jsdom
 *
 * Likely relevant first: the results ordered by the papers rated so far, the order kept while the
 * person rates, and made again when they ask.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { ratings, ordered, failed, setPage } = vi.hoisted(() => ({
  ratings: { current: {} as Record<string, number> },
  ordered: vi.fn(),
  failed: vi.fn(),
  setPage: vi.fn(),
}));

const paper = (n: number) => ({ id: `https://openscholar.ai/OS${n}` });
const RESULTS = [1, 2, 3, 4].map(paper);

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/actions/openalex", () => ({ getClosenessOrder: ordered }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ error: failed }) }));
vi.mock("@/lib/search", () => ({ useSearchOptional: () => ({ searchId: "search-1", results: RESULTS, setPage }) }));
vi.mock("@/lib/store", () => ({
  useRatingsStore: <T,>(select: (state: { ratings: Record<string, number> }) => T) => select({ ratings: ratings.current }),
}));

import { LikelyFirst } from "@/components/search-command-center/components/likely-first";
import { useLikelyOrderStore } from "@/lib/search/likely-order";

beforeEach(() => {
  useLikelyOrderStore.setState({ orders: {} });
  ratings.current = { [paper(1).id]: 5, [paper(3).id]: 1 };
  ordered.mockResolvedValue({ ok: true, order: [paper(2), paper(4), paper(1), paper(3)].map(({ id }) => ({ id, score: 0.1 })) });
});

afterEach(() => {
  ordered.mockReset();
  failed.mockReset();
  setPage.mockReset();
});

describe("likely relevant first", () => {
  it("is offered once a result is rated 4 or 5", () => {
    ratings.current = { [paper(3).id]: 1 };
    const { container } = render(<LikelyFirst />);
    expect(container).toBeEmptyDOMElement();
  });

  it("orders the results by the papers rated alike and unlike, from the first page, and stays pressed", async () => {
    render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "likelyFirst" })).toHaveAttribute("aria-pressed", "true"));
    expect(ordered).toHaveBeenCalledWith(["OS1", "OS2", "OS3", "OS4"], ["OS1"], ["OS3"]);
    // The API's order is 2, 4, 1, 3: the papers not rated yet, 2 and 4, come before 1 and 3, rated.
    expect(useLikelyOrderStore.getState().orders["search-1"]?.ids).toEqual([2, 4, 1, 3].map((n) => paper(n).id));
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it("keeps the order while the person rates, offers to order again, and puts the search's own back when pressed", async () => {
    const { rerender } = render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(useLikelyOrderStore.getState().orders["search-1"]).toBeDefined());
    expect(screen.queryByRole("button", { name: "likelyFirstResort" })).not.toBeInTheDocument();
    const before = useLikelyOrderStore.getState().orders["search-1"]?.ids;
    ratings.current = { ...ratings.current, [paper(2).id]: 4 };
    rerender(<LikelyFirst />);
    // Rated now, paper 2 stays where it was until the person orders again.
    expect(useLikelyOrderStore.getState().orders["search-1"]?.ids).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirstResort" }));
    await waitFor(() => expect(ordered).toHaveBeenLastCalledWith(["OS1", "OS2", "OS3", "OS4"], ["OS1", "OS2"], ["OS3"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "likelyFirstResort" })).not.toBeInTheDocument());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    });
    expect(useLikelyOrderStore.getState().orders["search-1"]).toBeUndefined();
  });

  it("says when the results couldn't be ordered, and leaves them as they were", async () => {
    ordered.mockResolvedValue({ ok: false, status: 503, message: "down" });
    render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(failed).toHaveBeenCalledWith("likelyFirstFailed", "down"));
    expect(useLikelyOrderStore.getState().orders["search-1"]).toBeUndefined();
    ordered.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(failed).toHaveBeenLastCalledWith("likelyFirstFailed"));
  });
});
