import React from 'react';
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Star } from "lucide-react";
import { useSearchFormStore, useSearchHistoryStore } from "@/lib/store";

export function RatingRangePicker() {
  const {
    ratingRange,
    isRatingFilterActive,
    onlyRatedPapers,
    currentSearchId,
    setRatingRange,
    setIsRatingFilterActive,
    setOnlyRatedPapers,
  } = useSearchFormStore();

  const { updateSearchResult } = useSearchHistoryStore();

  const updateCurrentSearchRatingFilter = (newRatingRange: [number, number], newIsActive: boolean, newOnlyRated: boolean) => {
    if (currentSearchId) {
      updateSearchResult(currentSearchId, {
        ratingRange: newRatingRange,
        isRatingFilterActive: newIsActive,
        onlyRatedPapers: newOnlyRated,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleToggleChange = (checked: boolean) => {
    setOnlyRatedPapers(checked);
    let newRange = ratingRange;
    let newIsActive = checked;
    
    if (checked) {
      // When enabling, activate the filter
      setIsRatingFilterActive(true);
    } else {
      // When disabling, deactivate the filter and reset range
      setIsRatingFilterActive(false);
      setRatingRange([0, 5]);
      newRange = [0, 5];
      newIsActive = false;
    }
    // Update the current search result to persist the changes
    updateCurrentSearchRatingFilter(newRange, newIsActive, checked);
    // No need to fetch new results - rating filter works client-side
  };

  const handleRatingChange = (values: number[]) => {
    const newRange: [number, number] = [values[0], values[1]];
    setRatingRange(newRange);
    // Filter is active when toggle is on
    const newIsActive = onlyRatedPapers;
    setIsRatingFilterActive(newIsActive);
    // Update the current search result to persist the changes
    updateCurrentSearchRatingFilter(newRange, newIsActive, onlyRatedPapers);
    // No need to fetch new results - rating filter works client-side
  };

  const getRatingLabel = (rating: number) => {
    if (rating === 0) return "0 stars";
    return `${rating} star${rating > 1 ? 's' : ''}`;
  };

  const renderStars = (rating: number) => {
    if (rating === 0) {
      return (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
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
            key={i}
            className={`h-4 w-4 ${
              i < rating 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-muted-foreground/20'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toggle for Only Rated Papers */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">
            Only show rated papers
          </label>
          <p className="text-xs text-muted-foreground">
            Hide papers you haven't rated yet
          </p>
        </div>
        <Switch
          checked={onlyRatedPapers}
          onCheckedChange={handleToggleChange}
        />
      </div>

      {/* Rating Range Slider - Only shown when toggle is enabled */}
      {onlyRatedPapers && (
        <>
          {/* Current Range Display */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                {renderStars(ratingRange[0])}
              </div>
              <span className="text-muted-foreground">to</span>
              <div className="flex items-center gap-2">
                {renderStars(ratingRange[1])}
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
              onValueChange={handleRatingChange}
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
      {isRatingFilterActive && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-xs text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/30 px-3 py-2 rounded-full">
            <Star className="h-3 w-3 fill-orange-500 text-orange-500" />
            <span>
              {onlyRatedPapers 
                ? `Showing ${getRatingLabel(ratingRange[0])} to ${getRatingLabel(ratingRange[1])}`
                : "Filter active"
              }
            </span>
          </div>
        </div>
      )}
    </div>
  );
} 