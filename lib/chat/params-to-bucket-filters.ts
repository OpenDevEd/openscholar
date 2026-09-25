import type { SearchParams } from "@/lib/search/types";

export type BucketSearchFilters = {
  query?: string;
  field?: string;
  searchField?: string;
  sortBy?: string;
  yearRange?: [number, number];
  isYearRangeEnabled?: boolean;
  dateRange?: { from?: string; to?: string };
  filterType?: string;
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
  researchAreas?: string[];
  sdgs?: string[];
  openAccessOnly?: boolean;
  workTypes?: string[];
  language?: string;
};

export function paramsToBucketSearchFilters(
  params: SearchParams,
): BucketSearchFilters {
  const filters: BucketSearchFilters = {};

  if (params.q) filters.query = params.q;
  if (params.field) {
    filters.field = params.field;
    filters.searchField = params.field;
  }
  if (params.sort) filters.sortBy = params.sort;
  if (params.ft) filters.filterType = params.ft;

  if (params.yf !== null && params.yt !== null) {
    filters.yearRange = [params.yf, params.yt];
    filters.isYearRangeEnabled = true;
  } else {
    filters.isYearRangeEnabled = false;
  }

  if (params.df !== null || params.dt !== null) {
    filters.dateRange = {
      from: params.df ?? undefined,
      to: params.dt ?? undefined,
    };
  }

  filters.ratingRange = [params.rmin, params.rmax];
  filters.onlyRatedPapers = params.rated;

  if (params.reg.length > 0) filters.selectedRegions = params.reg;
  if (params.focus.length > 0) filters.selectedCountryFocus = params.focus;

  if (params.cites) filters.citesItemId = params.cites;
  if (params.citedBy) filters.citedByItemId = params.citedBy;
  if (params.rel) filters.relatedToItemId = params.rel;

  filters.reviewFilter = params.review;
  if (params.area.length > 0) filters.researchAreas = params.area;
  if (params.sdg.length > 0) filters.sdgs = params.sdg;
  if (params.oa) filters.openAccessOnly = true;
  if (params.type.length > 0) filters.workTypes = params.type;

  if (params.lang) filters.language = params.lang;

  return filters;
}
