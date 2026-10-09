/**
 * @vitest-environment jsdom
 *
 * The sidebar's sort picker. A question asked by meaning is listed by relevance
 * alone, so the picker shows that order, can't change it, and says why.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { formState } = vi.hoisted(() => ({
  formState: { current: {} as Record<string, unknown> },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/hooks", () => ({
  useCurrentSearchFormState: () => formState.current,
  useUpdateSearchFilter: () => vi.fn(),
}));
// The pickers that read Convex or OpenAlex aren't what this test is about.
vi.mock("@/components/rating-range-picker", () => ({ RatingRangePicker: () => null }));
vi.mock("@/components/shared/publication-timeframe-filter", () => ({ PublicationTimeframeFilter: () => null }));
vi.mock("@/components/country-region-picker", () => ({ CountryRegionPicker: () => null }));
vi.mock("@/components/country-focus-picker", () => ({ CountryFocusPicker: () => null }));
vi.mock("@/components/work-id-filter", () => ({ WorkIdFilter: () => null }));
vi.mock("@/components/research-area-filter", () => ({ ResearchAreaFilter: () => null }));
vi.mock("@/components/funder-filter", () => ({ FunderFilter: () => null }));
vi.mock("@/components/author-filter", () => ({ AuthorFilter: () => null }));

import { SidebarContent } from "@/components/search-sidebar";

function showSidebar(search: { field: string; query: string; sortBy: string }) {
  formState.current = {
    currentSearchField: search.field, currentQuery: search.query, sortBy: search.sortBy,
    dateRange: undefined, filterType: "year", isYearRangeEnabled: false, yearRange: [1900, 2026],
    ratingRange: [0, 5], onlyRatedPapers: false, selectedRegions: [], selectedCountryFocus: [],
    citesItemId: "", citedByItemId: "", relatedToItemId: "", reviewFilter: false, researchAreas: [], sdgs: [],
    openAccessOnly: false, hasAbstract: false, includeRetracted: false, workTypes: [], workLanguages: [],
    institutionTypes: [], funders: [], authors: [], minCitations: null,
  };
  render(
    <SidebarContent activeFiltersCount={0} isCitesActive={false} isCitedByActive={false} isRelatedToActive={false} onClearAllFilters={vi.fn()} />,
  );
  // The sort picker's trigger shows the order it lists by.
  return screen.getAllByRole("combobox").find((trigger) => trigger.textContent?.startsWith("sort"));
}

describe("the sort picker", () => {
  it("shows relevance, and can't change it, for a question asked by meaning", () => {
    const picker = showSidebar({ field: "semantic", query: "What helps teachers stay in rural schools?", sortBy: "cited_by_count:desc" });
    expect(picker).toHaveTextContent("sortRelevance");
    expect(picker).toBeDisabled();
    expect(screen.getByText("sortByMeaning")).toBeInTheDocument();
  });

  it("keeps the chosen sort while no question is asked by meaning", () => {
    const picker = showSidebar({ field: "semantic", query: " ", sortBy: "cited_by_count:desc" });
    expect(picker).toHaveTextContent("sortCitationsDesc");
    expect(picker).toBeEnabled();
    expect(screen.queryByText("sortByMeaning")).not.toBeInTheDocument();
  });

  it("keeps the chosen sort for a keyword search", () => {
    const picker = showSidebar({ field: "title_and_abstract", query: "rural teachers", sortBy: "cited_by_count:desc" });
    expect(picker).toHaveTextContent("sortCitationsDesc");
    expect(picker).toBeEnabled();
  });
});
