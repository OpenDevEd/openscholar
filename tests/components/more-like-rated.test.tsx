/**
 * @vitest-environment jsdom
 *
 * More like the papers rated 4 or 5 among the results shown: one search for the works nearest them all.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { results, ratings, filter, push } = vi.hoisted(() => ({
  results: { current: [] as { id: string }[] },
  ratings: { current: {} as Record<string, number> },
  // The search's rating filter, off unless a test turns it on.
  filter: { current: { rmin: 0, rmax: 5, rated: false } },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/search", () => ({ useSearchOptional: () => ({ results: results.current, params: filter.current }) }));
vi.mock("@/lib/store", () => ({
  useRatingsStore: <T,>(select: (state: { ratings: Record<string, number> }) => T) => select({ ratings: ratings.current }),
  useSearchHistoryStore: { getState: () => ({ addSearchResult: () => "more-like-these" }) },
}));

import { MoreLikeRated } from "@/components/search-command-center/components/more-like-rated";

afterEach(() => {
  push.mockReset();
  filter.current = { rmin: 0, rmax: 5, rated: false };
});

describe("more like the papers rated", () => {
  it("finds the works nearest the results rated 4 or 5, all of them at once", () => {
    results.current = [{ id: "https://openscholar.ai/OS1" }, { id: "https://openscholar.ai/OS2" }, { id: "https://openscholar.ai/OS3" }];
    ratings.current = { "https://openscholar.ai/OS1": 5, "https://openscholar.ai/OS2": 3, "https://openscholar.ai/OS3": 4 };
    render(<MoreLikeRated />);
    screen.getByRole("button", { name: 'moreLikeRated:{"count":2}' }).click();
    const url = new URL(String(push.mock.calls[0]?.[0]), "https://openscholar.test");
    expect([url.pathname, url.searchParams.get("like")]).toEqual(["/results/more-like-these", "OS1,OS3"]);
  });

  it("leaves out the papers the rating filter hides from the results", () => {
    results.current = [{ id: "https://openscholar.ai/OS1" }, { id: "https://openscholar.ai/OS2" }];
    ratings.current = { "https://openscholar.ai/OS1": 5, "https://openscholar.ai/OS2": 4 };
    filter.current = { rmin: 5, rmax: 5, rated: true };
    render(<MoreLikeRated />);
    screen.getByRole("button", { name: 'moreLikeRated:{"count":1}' }).click();
    expect(new URL(String(push.mock.calls[0]?.[0]), "https://openscholar.test").searchParams.get("like")).toBe("OS1");
  });

  it("says when it finds more like only the first hundred of them, as a search takes no more", () => {
    results.current = Array.from({ length: 105 }, (_, at) => ({ id: `https://openscholar.ai/OS${at + 1}` }));
    ratings.current = Object.fromEntries(results.current.map((paper) => [paper.id, 5]));
    render(<MoreLikeRated />);
    screen.getByRole("button", { name: 'moreLikeRatedFirst:{"count":100}' }).click();
    const like = new URL(String(push.mock.calls[0]?.[0]), "https://openscholar.test").searchParams.get("like")?.split(",");
    expect([like?.length, like?.[0], like?.at(-1)]).toEqual([100, "OS1", "OS100"]);
  });

  it("offers nothing when no result shown is rated 4 or 5", () => {
    results.current = [{ id: "https://openscholar.ai/OS1" }];
    ratings.current = { "https://openscholar.ai/OS1": 3 };
    render(<MoreLikeRated />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
