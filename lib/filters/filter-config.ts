/**
 * Filter Configuration
 * Centralized configuration for filter display (colors, icons, labels)
 */

import {
  FileText,
  ArrowUpDown,
  Calendar,
  Clock,
  Globe,
  Languages,
  BookCheck,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  GitCompare,
  LucideIcon,
} from "lucide-react";
import { FilterSectionType, FilterType } from "./filter-types";

/**
 * Section configuration for each filter category
 */
export const SECTION_CONFIG: Record<
  FilterSectionType,
  {
    title: string;
    tooltipColor: string;
    badgeColor: string;
  }
> = {
  search: {
    title: "Search",
    tooltipColor: "bg-orange-500/10 border-orange-500/20",
    badgeColor: "bg-primary/10 text-primary",
  },
  time: {
    title: "Time",
    tooltipColor: "bg-purple-500/10 border-purple-500/20",
    badgeColor: "bg-blue-50 text-blue-700",
  },
  geographic: {
    title: "Geographic",
    tooltipColor: "bg-emerald-500/10 border-emerald-500/20",
    badgeColor: "bg-emerald-50 text-emerald-700",
  },
  content: {
    title: "Content",
    tooltipColor: "bg-blue-500/10 border-blue-500/20",
    badgeColor: "bg-pink-50 text-pink-700",
  },
  ratings: {
    title: "Ratings",
    tooltipColor: "bg-green-500/10 border-green-500/20",
    badgeColor: "bg-amber-50 text-amber-700",
  },
  citations: {
    title: "Citations",
    tooltipColor: "bg-pink-500/10 border-pink-500/20",
    badgeColor: "bg-orange-50 text-orange-700",
  },
};

/**
 * Icon mapping for each filter type
 */
export const FILTER_ICONS: Record<FilterType, LucideIcon> = {
  field: FileText,
  sort: ArrowUpDown,
  year: Calendar,
  date: Clock,
  regions: Globe,
  countryFocus: Languages,
  language: Languages,
  review: BookCheck,
  rating: Star,
  onlyRated: Star,
  cites: ArrowDownRight,
  citedBy: ArrowUpRight,
  relatedTo: GitCompare,
};

/**
 * Emoji mapping for each filter type (used in history page badges)
 */
export const FILTER_EMOJIS: Record<FilterType, string> = {
  field: "", // Field uses different display in history
  sort: "", // Sort uses different display in history
  year: "📅",
  date: "📅",
  regions: "🌍",
  countryFocus: "🎯",
  language: "🌐",
  review: "📄",
  rating: "⭐",
  onlyRated: "⭐",
  cites: "📑",
  citedBy: "📋",
  relatedTo: "🔗",
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

/**
 * Sidebar-aligned badge colors (muted, subtle)
 * Used in tooltip to match sidebar aesthetic
 */
export const SIDEBAR_BADGE_COLORS: Record<FilterType, string> = {
  field: "bg-muted/60 text-foreground/80",
  sort: "bg-muted/50 text-muted-foreground",
  year: "bg-muted/50 text-muted-foreground",
  date: "bg-muted/50 text-muted-foreground",
  regions: "bg-muted/50 text-muted-foreground",
  countryFocus: "bg-muted/50 text-muted-foreground",
  language: "bg-muted/50 text-muted-foreground",
  review: "bg-muted/50 text-muted-foreground",
  rating: "bg-muted/50 text-muted-foreground",
  onlyRated: "bg-muted/50 text-muted-foreground",
  cites: "bg-muted/50 text-muted-foreground",
  citedBy: "bg-muted/50 text-muted-foreground",
  relatedTo: "bg-muted/50 text-muted-foreground",
};

/**
 * History page badge colors (colored, more prominent)
 * Refined versions of original colors - slightly less saturated
 */
export const HISTORY_BADGE_COLORS: Record<FilterType, string> = {
  field: "bg-primary/10 text-primary",
  sort: "bg-purple-100/80 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  year: "bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  date: "bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  regions: "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  countryFocus: "bg-violet-100/80 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  language: "bg-sky-100/80 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  review: "bg-pink-100/80 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  rating: "bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  onlyRated: "bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  cites: "bg-orange-100/80 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  citedBy: "bg-teal-100/80 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  relatedTo: "bg-indigo-100/80 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};
