"use client";

/**
 * Filter Display Components
 * Unified components for rendering filter information
 * Supports both sidebar (muted) and history (colored) variants
 */

import React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/ui/country-flag";
import { Star } from "lucide-react";
import { DateRange } from "react-day-picker";
import type { SearchField } from "@/lib/types/search.types";
import {
  FilterItem,
  FilterParams,
  FilterType,
  SIDEBAR_BADGE_COLORS,
  HISTORY_BADGE_COLORS,
  getAllFilterItems,
  type FilterT,
} from "@/lib/filters";

// ============ Unified Filter Badges (Single Source of Truth) ============

type BadgeVariant = "sidebar" | "history";

interface UnifiedFilterBadgesProps {
  /** Filter parameters to display */
  result: FilterParams & { sortBy?: string };
  /** Visual variant - sidebar uses muted colors, history uses colored */
  variant?: BadgeVariant;
  /** Additional class names */
  className?: string;
  /** Show all filters including field, or compact mode */
  showAll?: boolean;
}

/**
 * UnifiedFilterBadges - Single source of truth for filter badge display
 * 
 * @variant "sidebar" - Muted colors matching sidebar aesthetic (tooltips)
 * @variant "history" - Colored badges for history page (more prominent)
 */
export function UnifiedFilterBadges({
  result,
  variant = "sidebar",
  className,
  showAll = true,
}: UnifiedFilterBadgesProps) {
  const tFilters = useTranslations("searchFilters");
  const format = useFormatter();
  const formatDateTime = (d: Date, opts?: Intl.DateTimeFormatOptions) =>
    format.dateTime(d, opts as Parameters<typeof format.dateTime>[1]);
  // Get all filter items as a flat array
  const filterItems = getAllFilterItems(result, tFilters as FilterT, formatDateTime);
  
  if (filterItems.length === 0 && !showAll) return null;

  const isSidebar = variant === "sidebar";
  const colorMap = isSidebar ? SIDEBAR_BADGE_COLORS : HISTORY_BADGE_COLORS;
  
  // Base badge styling per variant
  const baseBadgeClass = isSidebar
    ? "text-[10px] px-1.5 py-0.5 rounded"
    : "text-xs px-2 py-1 rounded-md";

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5",
        isSidebar ? "gap-1" : "gap-2",
        className
      )}
    >
      {filterItems.map((item) => (
        <UnifiedBadge
          key={item.key}
          item={item}
          colorClass={colorMap[item.type]}
          baseClass={baseBadgeClass}
          variant={variant}
        />
      ))}
    </div>
  );
}

// ============ Internal Badge Component ============

interface UnifiedBadgeProps {
  item: FilterItem;
  colorClass: string;
  baseClass: string;
  variant: BadgeVariant;
}

function UnifiedBadge({ item, colorClass, baseClass, variant }: UnifiedBadgeProps) {
  const isSidebar = variant === "sidebar";
  
  // Special rendering for geographic filters with flags
  if (
    (item.type === "regions" || item.type === "countryFocus") &&
    item.countryCodes &&
    item.countryCodes.length > 0
  ) {
    return (
      <span className={cn(baseClass, colorClass, "flex items-center gap-1")}>
        {item.emoji && <span>{item.emoji}</span>}
        <span>{isSidebar ? item.displayValue : `${item.label}: ${item.displayValue}`}</span>
        {!isSidebar && (
          <span className="flex items-center gap-0.5 ml-0.5">
            {item.countryCodes.slice(0, 3).map((code) => (
              <CountryFlag key={code} countryCode={code} className="w-3 h-2" />
            ))}
            {item.countryCodes.length > 3 && (
              <span className="text-[10px] opacity-70">+{item.countryCodes.length - 3}</span>
            )}
          </span>
        )}
      </span>
    );
  }

  // Special rendering for rating with visual stars (history variant only)
  if (item.type === "rating" && item.ratingRange && !isSidebar) {
    return (
      <span className={cn(baseClass, colorClass, "flex items-center gap-1")}>
        {item.emoji && <span>{item.emoji}</span>}
        <RatingStarsDisplay range={item.ratingRange} size="sm" />
      </span>
    );
  }

  const t = useTranslations("filterDisplay");
  const labelMap: Record<string, string> = {
    cites: t("cites"),
    citedBy: t("citedBy"),
    relatedTo: t("relatedTo"),
    review: t("reviews"),
    onlyRated: t("rated"),
  };
  const resolvedLabel = labelMap[item.type] ?? item.label;
  // Default rendering
  const displayText = isSidebar
    ? (item.type === "field" ? item.displayValue : (item.emoji ? `${item.emoji} ${item.displayValue}` : item.displayValue))
    : (item.emoji ? `${item.emoji} ${resolvedLabel}: ${item.displayValue}` : `${resolvedLabel}: ${item.displayValue}`);

  // Sidebar variant uses even more compact display
  const sidebarCompactText = isSidebar
    ? (item.type === "field" 
        ? item.displayValue 
        : item.type === "review" 
          ? t("reviews")
          : item.type === "onlyRated"
            ? t("rated")
            : `${item.emoji || ""} ${item.displayValue}`.trim())
    : displayText;

  return (
    <span className={cn(baseClass, colorClass)}>
      {isSidebar ? sidebarCompactText : displayText}
    </span>
  );
}

// ============ Shared Display Components ============

interface RatingStarsDisplayProps {
  range: [number, number];
  size?: "sm" | "md";
  className?: string;
}

/**
 * Renders star rating visualization
 */
export function RatingStarsDisplay({
  range,
  size = "md",
  className,
}: RatingStarsDisplayProps) {
  const [min, max] = range;
  const starSize = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <div className={cn("flex gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const isActive = star >= min && star <= max;
        return (
          <Star
            key={star}
            className={cn(
              starSize,
              isActive
                ? "text-amber-500 fill-amber-500"
                : "text-muted-foreground/30"
            )}
          />
        );
      })}
    </div>
  );
}

// ============ History Page Filter Badges (Wrapper for API compatibility) ============

interface HistoryFilterBadgesProps {
  result: {
    field?: string;
    sortBy?: string;
    dateRange?: DateRange;
    yearRange?: [number, number];
    filterType?: "date" | "year";
    isYearRangeEnabled?: boolean;
    selectedRegions?: string[];
    selectedCountryFocus?: string[];
    citesItemId?: string;
    citedByItemId?: string;
    relatedToItemId?: string;
    ratingRange?: [number, number];
    onlyRatedPapers?: boolean;
    reviewFilter?: boolean;
  };
  variant?: "compact" | "full";
  className?: string;
}

/**
 * HistoryFilterBadges - Uses UnifiedFilterBadges internally
 * Kept for API compatibility with existing history page
 */
export function HistoryFilterBadges({
  result,
  variant = "compact",
  className,
}: HistoryFilterBadgesProps) {
  // Cast field to SearchField for type compatibility
  const filterParams = {
    ...result,
    field: result.field as SearchField | undefined,
  };

  return (
    <UnifiedFilterBadges
      result={filterParams}
      variant="history"
      className={className}
      showAll={false}
    />
  );
}
