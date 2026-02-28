"use client";

import { useTranslations } from "next-intl";
import { Star, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SortBy = "savedAt" | "rating" | "publicationYear";
type SortOrder = "asc" | "desc";

interface LibraryFiltersProps {
  minRating: number | undefined;
  onMinRatingChange: (rating: number | undefined) => void;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (sortOrder: SortOrder) => void;
  sortDisabled: boolean;
}

export function LibraryFilters({
  minRating,
  onMinRatingChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  sortDisabled,
}: LibraryFiltersProps) {
  const t = useTranslations("libraryPage");

  const handleStarClick = (starValue: number) => {
    if (minRating === starValue) {
      onMinRatingChange(undefined);
    } else {
      onMinRatingChange(starValue);
    }
  };

  const toggleSortOrder = () => {
    onSortOrderChange(sortOrder === "asc" ? "desc" : "asc");
  };

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: "savedAt", label: t("sortDateSaved") },
    { value: "rating", label: t("sortRating") },
    { value: "publicationYear", label: t("sortPublicationYear") },
  ];

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Rating star filter */}
      <div className="flex items-center gap-1" role="group" aria-label={t("ratingFilter")}>
        {[1, 2, 3, 4, 5].map((starValue) => {
          const isActive = minRating !== undefined && starValue <= minRating;
          const isSelected = minRating === starValue;
          return (
            <Tooltip key={starValue} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleStarClick(starValue)}
                  className={cn(
                    "p-0.5 rounded transition-colors hover:scale-110",
                    isSelected && "ring-1 ring-primary/30 rounded-sm",
                  )}
                  aria-label={
                    isSelected
                      ? t("clearRatingFilter")
                      : `${starValue}+`
                  }
                >
                  <Star
                    className={cn(
                      "h-4 w-4 transition-colors",
                      isActive
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/40 hover:text-amber-300",
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {isSelected ? t("clearRatingFilter") : `${starValue}+`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-1.5 ml-auto">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <span>
              <Select
                value={sortBy}
                onValueChange={(v) => onSortByChange(v as SortBy)}
                disabled={sortDisabled}
              >
                <SelectTrigger
                  className={cn(
                    "h-8 w-[160px] text-xs",
                    sortDisabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span className="text-muted-foreground mr-1">{t("sortBy")}:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          </TooltipTrigger>
          {sortDisabled && (
            <TooltipContent side="bottom" className="text-xs">
              {t("sortDisabledInSearch")}
            </TooltipContent>
          )}
        </Tooltip>

        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={toggleSortOrder}
              disabled={sortDisabled}
              className={cn(
                "shrink-0",
                sortDisabled && "opacity-50 cursor-not-allowed",
              )}
              aria-label={sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
            >
              {sortOrder === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
