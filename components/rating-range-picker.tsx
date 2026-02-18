"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Star, X } from "lucide-react";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { cn, isRatingFilterActive, DEFAULT_FILTERS } from "@/lib/utils";
import { useTranslations } from "next-intl";

function StarRatingDisplay({ rating }: { rating: number }) {
  if (rating === 0) {
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={`star-slot-${i}`}
            className="h-4 w-4 text-muted-foreground/20"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={`star-slot-${i}`}
          className={cn(
            "h-4 w-4",
            i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/20"
          )}
        />
      ))}
    </div>
  );
}

export function RatingRangePicker() {
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");
  const {
    ratingRange,
    onlyRatedPapers,
  } = useCurrentSearchFormState();

  const updateFilter = useUpdateSearchFilter();

  // Computed filter active state
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);

  const handleRangeChange = (newRange: number[]) => {
    updateFilter({ 
      ratingRange: [newRange[0], newRange[1]] as [number, number]
    });
  };

  const handleOnlyRatedChange = (checked: boolean) => {
    updateFilter({ 
      onlyRatedPapers: checked,
    });
  };

  const handleClearFilter = () => {
    updateFilter({ 
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers
    });
  };

  const getRatingLabel = (rating: number) => {
    if (rating === 0) return tf("zeroStars");
    return tf("nStars", { count: rating });
  };

  return (
    <div className="space-y-6">
      {/* Toggle for Only Rated Papers */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">
            {tf("onlyShowRated")}
          </label>
          <p className="text-xs text-muted-foreground">
            {tf("hideUnrated")}
          </p>
        </div>
        <Switch
          checked={onlyRatedPapers}
          onCheckedChange={handleOnlyRatedChange}
        />
      </div>

      {/* Rating Range Slider - Only shown when toggle is enabled */}
      {onlyRatedPapers && (
        <>
          {/* Current Range Display */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <StarRatingDisplay rating={ratingRange[0]} />
              </div>
              <span className="text-muted-foreground">{tc("to")}</span>
              <div className="flex items-center gap-2">
                <StarRatingDisplay rating={ratingRange[1]} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {getRatingLabel(ratingRange[0])} to {getRatingLabel(ratingRange[1])}
            </p>
          </div>

          {/* Slider */}
          <div className="px-3">
            <Slider
              value={ratingRange}
              onValueChange={handleRangeChange}
              min={0}
              max={5}
              step={1}
              className="w-full"
            />
          </div>

          {/* Rating Scale Reference */}
          <div className="flex justify-between items-center px-3 py-2 bg-muted/30 rounded-lg">
            <div className="flex flex-col items-center gap-1">
              <Star className="h-3 w-3 text-muted-foreground/40" />
              <span className="text-xs text-muted-foreground">0</span>
            </div>
            {[1, 2, 3, 4, 5].map((rating) => (
              <div key={rating} className="flex flex-col items-center gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                <span className="text-xs text-muted-foreground">{rating}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Active Filter Indicator */}
      {isRatingActive && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-xs text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/30 px-3 py-2 rounded-full">
            <Star className="h-3 w-3 fill-orange-500 text-orange-500" />
            <span>
              {onlyRatedPapers
                ? tf("showingRange", { range: `${getRatingLabel(ratingRange[0])} to ${getRatingLabel(ratingRange[1])}` })
                : tf("filterActive")
              }
            </span>
          </div>
        </div>
      )}
    </div>
  );
} 