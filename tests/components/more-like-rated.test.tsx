/**
 * @vitest-environment jsdom
 *
 * More like the papers rated 4 or 5 among the results shown: one search for the works nearest them all.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { results, ratings, push } = vi.hoisted(() => ({
  results: { current: [] as { id: string }[] },
  ratings: { current: {} as Record<string, number> },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/search", () => ({ useSearchOptional: () => ({ results: results.current }) }));
vi.mock("@/lib/store", () => ({
  useRatingsStore: <T,>(select: (state: { ratings: Record<string, number> }) => T) => select({ ratings: ratings.current }),
  useSearchHistoryStore: { getState: () => ({ addSearchResult: () => "more-like-these" }) },
}));

import { MoreLikeRated } from "@/components/search-command-center/components/more-like-rated";

afterEach(() => {
  push.mockReset();
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

  it("offers nothing when no result shown is rated 4 or 5", () => {
    results.current = [{ id: "https://openscholar.ai/OS1" }];
    ratings.current = { "https://openscholar.ai/OS1": 3 };
    render(<MoreLikeRated />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
