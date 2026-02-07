"use client";

import React from 'react';
import { Star } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRatingsStore } from "@/lib/store";
import posthog from "posthog-js";

interface RatingSelectorProps {
  paperId: string;
  variant?: "default" | "compact";
}

export function RatingSelector({ paperId, variant = "default" }: RatingSelectorProps) {
  const { ratings, setRating } = useRatingsStore();

  const handleRatingChange = (rating: string) => {
    const previousRating = ratings[paperId];
    const newRating = rating === "no-rating" ? null : parseInt(rating);

    if (rating === "no-rating") {
      setRating(paperId, null);
    } else {
      setRating(paperId, parseInt(rating));
    }

    // Track paper rating event
    posthog.capture("paper_rated", {
      paper_id: paperId,
      rating: newRating,
      previous_rating: previousRating ?? null,
      is_rating_removed: rating === "no-rating",
      variant: variant,
    });
  };

  const currentRating = ratings[paperId];
  
  // Compact variant for mobile focus mode
  if (variant === "compact") {
    const renderCompactStar = () => {
      if (currentRating === undefined) {
        // No rating - star with diagonal line
        return (
          <div className="relative">
            <Star className="h-3 w-3 text-muted-foreground" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3 h-px bg-muted-foreground rotate-45"></div>
            </div>
          </div>
        );
      } else if (currentRating === 0) {
        // 0 stars - empty star
        return <Star className="h-3 w-3 text-muted-foreground" />;
      } else {
        // 1-5 stars - filled yellow star
        return <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />;
      }
    };

    return (
      <Select
        value={currentRating?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger className="h-8 w-auto min-w-[4rem] px-2">
          <div className="flex items-center gap-1">
            {renderCompactStar()}
            <span className="text-xs">
              {currentRating === undefined ? "—" : currentRating}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating">No Rating</SelectItem>
          <SelectItem value="0">☆ 0 Stars</SelectItem>
          <SelectItem value="1">⭐ 1 Star</SelectItem>
          <SelectItem value="2">⭐⭐ 2 Stars</SelectItem>
          <SelectItem value="3">⭐⭐⭐ 3 Stars</SelectItem>
          <SelectItem value="4">⭐⭐⭐⭐ 4 Stars</SelectItem>
          <SelectItem value="5">⭐⭐⭐⭐⭐ 5 Stars</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Default variant
  return (
    <div className="flex items-center gap-3 mb-3">
      <Select
        value={ratings[paperId]?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger className="min-w-48">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating">No Rating</SelectItem>
          <SelectItem value="0">☆ 0 Stars</SelectItem>
          <SelectItem value="1">⭐ 1 Star</SelectItem>
          <SelectItem value="2">⭐⭐ 2 Stars</SelectItem>
          <SelectItem value="3">⭐⭐⭐ 3 Stars</SelectItem>
          <SelectItem value="4">⭐⭐⭐⭐ 4 Stars</SelectItem>
          <SelectItem value="5">⭐⭐⭐⭐⭐ 5 Stars</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
} 