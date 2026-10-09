/**
 * @vitest-environment jsdom
 *
 * A paper's view lists the papers closest in meaning to it, with a way to see them all as a search.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const { similar, push } = vi.hoisted(() => ({ similar: vi.fn(), push: vi.fn() }));

vi.mock("@/app/actions/openalex", () => ({ getSimilarWorks: similar }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  useFormatter: () => ({ number: (n: number) => String(n) }),
}));

import { SIMILAR_SHOWN, SimilarPapers } from "@/components/focus-mode/similar-papers";

function show(paperId = "https://openscholar.ai/OS64233829") {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SimilarPapers paperId={paperId} />
    </SWRConfig>,
  );
}

afterEach(() => {
  similar.mockReset();
  push.mockReset();
});

describe("a paper's similar papers", () => {
  it("lists the closest, each with its year and citations, linked to its DOI when it has one", async () => {
    similar.mockResolvedValue({
      ok: true,
      data: {
        meta: { count: 2 },
        results: [
          { id: "https://openscholar.ai/OS1", display_name: "Rural teacher retention in the Midwest", publication_year: 2018, cited_by_count: 3, doi: "https://doi.org/10.1234/a" },
          { id: "https://openscholar.ai/OS2", display_name: "Retaining STEM teachers in Lebanon", publication_year: 2022, cited_by_count: 0, doi: null },
        ],
      },
    });
    show();
    expect(await screen.findByRole("link", { name: "Rural teacher retention in the Midwest" })).toHaveAttribute("href", "https://doi.org/10.1234/a");
    expect(screen.getByText("Retaining STEM teachers in Lebanon")).toBeInTheDocument();
    expect(similar).toHaveBeenCalledWith("https://openscholar.ai/OS64233829", SIMILAR_SHOWN);
    screen.getByRole("button", { name: "similarSeeAll" }).click();
    expect(new URL(String(push.mock.calls[0]?.[0]), "https://openscholar.test").searchParams.get("like")).toBe("OS64233829");
  });

  it("says when there are none, or when they couldn't be read", async () => {
    similar.mockResolvedValue({ ok: true, data: { meta: { count: 0 }, results: [] } });
    show("https://openscholar.ai/OS9");
    expect(await screen.findByText("similarNone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "similarSeeAll" })).not.toBeInTheDocument();
  });

  it("says when they couldn't be read", async () => {
    similar.mockResolvedValue({ ok: false, status: 503, message: "down" });
    show("https://openscholar.ai/OS10");
    await waitFor(() => expect(screen.getByText("similarFailed")).toBeInTheDocument());
  });
});
