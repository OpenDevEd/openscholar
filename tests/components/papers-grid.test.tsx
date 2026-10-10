/**
 * @vitest-environment jsdom
 *
 * A page of results as cards: each card opens focus mode at its place in the list focus mode shows,
 * the papers the list keeps in their order, whatever their place among the search's results.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaperResult } from "@/lib/types";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/paper-card", () => ({
  PaperCard: ({ result, resultIndex }: { result: { id: string }; resultIndex: number }) => <p data-testid="card">{`${result.id}@${resultIndex}`}</p>,
}));

import { PapersGrid } from "@/components/papers-grid";

const paper = (id: string) => ({ id }) as PaperResult;

function show(kept: PaperResult[], page = 1) {
  render(
    <PapersGrid
      filteredResults={kept}
      paginatedResults={kept.slice((page - 1) * 20, page * 20)}
      ratingRange={[0, 5]}
      onlyRatedPapers={false}
      currentPage={page}
      totalPages={Math.ceil(kept.length / 20)}
      onDownloadItem={vi.fn()}
      onDownloadEssentialItem={vi.fn()}
      onPageChange={vi.fn()}
      resultsContainerRef={{ current: null }}
      viewMode="list-detail"
    />,
  );
  return screen.getAllByTestId("card").map((card) => card.textContent);
}

describe("a page of results as cards", () => {
  it("opens each paper at its place among the papers kept, in their order", () => {
    const [a, c] = ["A", "C"].map(paper);
    // Of the search's results A, B, C and D, the rating filter keeps A and C, and the likely order puts C first.
    expect(show([c, a])).toEqual(["C@0", "A@1"]);
  });

  it("counts the places on later pages from the first", () => {
    const many = Array.from({ length: 25 }, (_, at) => paper(`P${at}`));
    expect(show(many, 2)).toEqual(Array.from({ length: 5 }, (_, at) => `P${20 + at}@${20 + at}`));
  });
});
