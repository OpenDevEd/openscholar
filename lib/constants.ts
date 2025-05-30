import { YearRangePreset } from "./types";

export const ITEMS_PER_PAGE = 20;

export const sortOptions = [
  { value: "relevance_score:desc", label: "Relevance (Most Relevant)" },
  { value: "cited_by_count:desc", label: "Citations (Most Cited)" },
  { value: "cited_by_count:asc", label: "Citations (Least Cited)" },
  { value: "publication_date:desc", label: "Publication Date (Newest)" },
  { value: "publication_date:asc", label: "Publication Date (Oldest)" },
  { value: "display_name:desc", label: "Title (Z-A)" },
  { value: "display_name:asc", label: "Title (A-Z)" },
] as const;

export const DEFAULT_YEAR_RANGE: [number, number] = [2020, new Date().getFullYear()];
export const MIN_YEAR = 1900;

export const getYearRangePresets = (): YearRangePreset[] => {
  const currentYear = new Date().getFullYear();
  return [
    { label: "This Year", range: [currentYear, currentYear] as [number, number] },
    { label: "Last Year", range: [currentYear - 1, currentYear - 1] as [number, number] },
    { label: "Last 5 Years", range: [currentYear - 5, currentYear] as [number, number] },
    { label: "Last 10 Years", range: [currentYear - 10, currentYear] as [number, number] },
    { label: "Last 15 Years", range: [currentYear - 15, currentYear] as [number, number] },
    { label: "Last 20 Years", range: [currentYear - 20, currentYear] as [number, number] },
  ];
}; 