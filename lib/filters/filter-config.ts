/**
 * Filter Configuration
 * Titles and icons for filter display. Icons match the sidebar cards.
 */

import {
  FileText,
  ArrowUpDown,
  Calendar,
  Clock,
  Globe,
  Focus,
  Languages,
  BookCheck,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  GitCompare,
  Library,
  Shapes,
  Globe2,
  LockOpen,
  LucideIcon,
} from "lucide-react";
import { FilterSectionType, FilterType } from "./filter-types";

export const SECTION_TITLES: Record<FilterSectionType, string> = {
  search: "Search",
  time: "Time",
  geographic: "Geographic",
  content: "Content",
  ratings: "Ratings",
  citations: "Citations",
};

export const FILTER_ICONS: Record<FilterType, LucideIcon> = {
  field: FileText,
  sort: ArrowUpDown,
  year: Calendar,
  date: Clock,
  regions: Globe,
  countryFocus: Focus,
  language: Languages,
  review: BookCheck,
  rating: Star,
  onlyRated: Star,
  cites: ArrowDownRight,
  citedBy: ArrowUpRight,
  relatedTo: GitCompare,
  workType: Library,
  researchArea: Shapes,
  sdg: Globe2,
  openAccess: LockOpen,
};

/**
 * Sort options configuration
 */
export const SORT_OPTIONS = [
  { value: "relevance_score", label: "Relevance" },
  { value: "publication_date", label: "Publication date" },
  { value: "cited_by_count", label: "Citations" },
  { value: "works_count", label: "Works count" },
] as const;
