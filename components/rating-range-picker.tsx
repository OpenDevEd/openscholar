"use client";

import React from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Star } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const STAR_SLOT_IDS = [
  "star-0",
  "star-1",
  "star-2",
  "star-3",
  "star-4",
] as const;

function StarRatingDisplay({ rating }: { rating: number }) {
  if (rating === 0) {
    return (
      <div className="flex items-center gap-0.5">
        {STAR_SLOT_IDS.map((id) => (
          <Star key={id} className="h-4 w-4 text-muted-foreground/20" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {STAR_SLOT_IDS.map((id, i) => (
        <Star
          key={id}
          className={cn(
            "h-4 w-4",
            i < rating
              ? "fill-rating text-rating"
              : "text-muted-foreground/20",
          )}
        />
      ))}
    </div>
  );
}

interface RatingRangePickerProps {
  /** Current rating range tuple */
  ratingRange: [number, number];
  /** Called when the range changes */
  onRatingRangeChange: (range: [number, number]) => void;
  /** Minimum slider value (0 for search, 1 for library) */
  minValue?: number;
  /** Whether the "only rated papers" toggle is on */
  onlyRatedPapers?: boolean;
  /** Called when the toggle changes */
  onOnlyRatedChange?: (checked: boolean) => void;
  /** Show the "only rated papers" toggle (search uses this; library doesn't) */
  showOnlyRatedToggle?: boolean;
  /** Show the active filter indicator badge */
  showActiveIndicator?: boolean;
}

/**
 * Shared rating range picker with slider, star display, and optional toggle.
 *
 * Accepts value+onChange props so it can be used by both the search results
 * page (with toggle + 0-5 range) and the library page (always-on, 1-5 range).
 */
export function RatingRangePicker({
  ratingRange,
  onRatingRangeChange,
  minValue = 0,
  onlyRatedPapers = true,
  onOnlyRatedChange,
  showOnlyRatedToggle = false,
  showActiveIndicator = false,
}: RatingRangePickerProps) {
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");

  const isRatingActive =
    ratingRange[0] !== minValue || ratingRange[1] !== 5;

  const handleRangeChange = (newRange: number[]) => {
    onRatingRangeChange([newRange[0], newRange[1]]);
  };

  const getRatingLabel = (rating: number) => {
    if (rating === 0) return tf("zeroStars");
    return tf("nStars", { count: rating });
  };

  // Show slider content when there's no toggle (always-on) or when the toggle is on
  const showSliderContent = !showOnlyRatedToggle || onlyRatedPapers;

  return (
    <div className="space-y-6">
      {/* "Only rated papers" toggle (search-only) */}
      {showOnlyRatedToggle && onOnlyRatedChange && (
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
            onCheckedChange={onOnlyRatedChange}
          />
        </div>
      )}

      {/* Slider content */}
      {showSliderContent && (
        <>
          {/* Current range display */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-4">
              <StarRatingDisplay rating={ratingRange[0]} />
              <span className="text-muted-foreground">{tc("to")}</span>
              <StarRatingDisplay rating={ratingRange[1]} />
            </div>
            <p className="text-sm text-muted-foreground">
              {getRatingLabel(ratingRange[0])} to{" "}
              {getRatingLabel(ratingRange[1])}
            </p>
          </div>

          {/* Slider */}
          <div className="px-3">
            <Slider
              value={ratingRange}
              onValueChange={handleRangeChange}
              min={minValue}
              max={5}
              step={1}
              className="w-full"
            />
          </div>

          {/* Rating scale reference */}
          <div className="flex justify-between items-center px-3 py-2 bg-inset rounded-lg">
            {minValue === 0 && (
              <div className="flex flex-col items-center gap-1">
                <Star className="h-3 w-3 text-muted-foreground/40" />
                <span className="text-xs text-muted-foreground">0</span>
              </div>
            )}
            {[1, 2, 3, 4, 5].map((rating) => (
              <div key={rating} className="flex flex-col items-center gap-1">
                <Star className="h-3 w-3 fill-rating text-rating" />
                <span className="text-xs text-muted-foreground">
                  {rating}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Active filter indicator (search-only) */}
      {showActiveIndicator && isRatingActive && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-xs tint-rating px-3 py-2 rounded-full">
            <Star className="h-3 w-3 fill-rating text-rating" />
            <span>
              {onlyRatedPapers
                ? tf("showingRange", {
                    range: `${getRatingLabel(ratingRange[0])} to ${getRatingLabel(ratingRange[1])}`,
                  })
                : tf("filterActive")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
