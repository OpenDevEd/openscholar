/**
 * @vitest-environment jsdom
 *
 * Likely relevant first: the results ordered by the papers rated so far, the order kept while the
 * person rates, and made again when they ask.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { ratings, ordered, failed, setPage, results } = vi.hoisted(() => ({
  ratings: { current: {} as Record<string, number> },
  ordered: vi.fn(),
  failed: vi.fn(),
  setPage: vi.fn(),
  results: { current: [] as { id: string }[] },
}));

const paper = (n: number) => ({ id: `https://openscholar.ai/OS${n}` });
const RESULTS = [1, 2, 3, 4].map(paper);

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/actions/openalex", () => ({ getClosenessOrder: ordered }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ error: failed }) }));
vi.mock("@/lib/search", () => ({ useSearchOptional: () => ({ searchId: "search-1", results: results.current, setPage }) }));
// The shared tooltip, with its label shown beside what it explains.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipHint: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <>
      {children}
      <span role="tooltip">{label}</span>
    </>
  ),
}));
vi.mock("@/lib/store", () => ({
  useRatingsStore: <T,>(select: (state: { ratings: Record<string, number> }) => T) => select({ ratings: ratings.current }),
}));

import { LikelyFirst } from "@/components/search-command-center/components/likely-first";
import { useLikelyOrdered, useLikelyOrderStore } from "@/lib/search/likely-order";

/** The button beside the results, shown in the order the results list shows them. */
function Page() {
  const shown = useLikelyOrdered("search-1", results.current, results.current);
  return (
    <>
      <LikelyFirst />
      <ol>
        {shown.map((one) => (
          <li key={one.id}>{one.id}</li>
        ))}
      </ol>
    </>
  );
}

beforeEach(() => {
  results.current = RESULTS;
  useLikelyOrderStore.setState({ orders: {} });
  ratings.current = { [paper(1).id]: 5, [paper(3).id]: 1 };
  // The API's order, closest first, rated and not mixed: paper 1, rated 5, first, and paper 3, rated 1, among the others.
  ordered.mockResolvedValue({ ok: true, order: [paper(1), paper(2), paper(3), paper(4)].map(({ id }) => ({ id, score: 0.1 })) });
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

  it("isn't offered for results from OpenAlex, which has no such order", () => {
    results.current = [{ id: "https://openalex.org/W1" }, { id: "https://openalex.org/W2" }];
    ratings.current = { "https://openalex.org/W1": 5 };
    const { container } = render(<LikelyFirst />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains itself with the shared tooltip, not the browser's", () => {
    render(<LikelyFirst />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("likelyFirstHint");
    expect(screen.getByRole("button", { name: "likelyFirst" })).not.toHaveAttribute("title");
  });

  it("orders the results by the papers rated alike and unlike, from the first page, and stays pressed", async () => {
    render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "likelyFirst" })).toHaveAttribute("aria-pressed", "true"));
    expect(ordered).toHaveBeenCalledWith(["OS1", "OS2", "OS3", "OS4"], ["OS1"], ["OS3"]);
    // Of the API's order, 1, 2, 3, 4, the papers not rated yet, 2 and 4, come before 1 and 3, rated.
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

  it("keeps the papers shown in place as the person rates them, until they order again", async () => {
    const { rerender } = render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "likelyFirst" })).toHaveAttribute("aria-pressed", "true"));
    const shown = () => screen.getAllByRole("listitem").map((item) => item.textContent);
    const before = shown();
    expect(before).toEqual([2, 4, 1, 3].map((n) => paper(n).id));
    // Paper 2, the first shown, is rated: it stays first.
    ratings.current = { ...ratings.current, [paper(2).id]: 4 };
    rerender(<Page />);
    expect(shown()).toEqual(before);
  });

  it("offers to order again when a paper is rated 3, or its rating taken off, which moves it among the rated", async () => {
    const { rerender } = render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(useLikelyOrderStore.getState().orders["search-1"]).toBeDefined());
    ratings.current = { ...ratings.current, [paper(2).id]: 3 };
    rerender(<LikelyFirst />);
    expect(screen.getByRole("button", { name: "likelyFirstResort" })).toBeInTheDocument();
  });

  it("offers to order again when a rating is taken off", async () => {
    ratings.current = { ...ratings.current, [paper(2).id]: 3 };
    const { rerender } = render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    await waitFor(() => expect(useLikelyOrderStore.getState().orders["search-1"]).toBeDefined());
    expect(screen.queryByRole("button", { name: "likelyFirstResort" })).not.toBeInTheDocument();
    const { [paper(2).id]: _taken, ...rest } = ratings.current;
    ratings.current = rest;
    rerender(<LikelyFirst />);
    expect(screen.getByRole("button", { name: "likelyFirstResort" })).toBeInTheDocument();
  });

  it("goes back to the first page as it's pressed, and not when an answer comes later", async () => {
    let answer: (value: unknown) => void = () => {};
    ordered.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<LikelyFirst />);
    fireEvent.click(screen.getByRole("button", { name: "likelyFirst" }));
    expect(setPage).toHaveBeenCalledWith(1);
    // The person moves on while the order is made, as to another page of other results.
    setPage.mockClear();
    await act(async () => {
      answer({ ok: true, order: [paper(2)].map(({ id }) => ({ id, score: 0.1 })) });
    });
    expect(setPage).not.toHaveBeenCalled();
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
