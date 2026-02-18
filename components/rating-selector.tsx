"use client";

import React from 'react';
import { Star } from "lucide-react";

function CompactStarDisplay({ currentRating }: { currentRating: number | undefined | null }) {
  if (currentRating === undefined || currentRating === null) {
    return (
      <div className="relative">
        <Star className="h-3 w-3 text-muted-foreground" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-px bg-muted-foreground rotate-45"></div>
        </div>
      </div>
    );
  }
  if (currentRating === 0) {
    return <Star className="h-3 w-3 text-muted-foreground" />;
  }
  return <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />;
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRatingsStore } from "@/lib/store";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";

interface RatingSelectorProps {
  paperId: string;
  variant?: "default" | "compact";
}

export function RatingSelector({ paperId, variant = "default" }: RatingSelectorProps) {
  const t = useTranslations('rating');
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
    return (
      <Select
        value={currentRating?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger className="h-8 w-auto min-w-[4rem] px-2">
          <div className="flex items-center gap-1">
            <CompactStarDisplay currentRating={currentRating} />
            <span className="text-xs">
              {currentRating === undefined ? "—" : currentRating}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating">{t('noRating')}</SelectItem>
          <SelectItem value="0">☆ {t('nStars', { count: 0 })}</SelectItem>
          <SelectItem value="1">⭐ {t('nStars', { count: 1 })}</SelectItem>
          <SelectItem value="2">⭐⭐ {t('nStars', { count: 2 })}</SelectItem>
          <SelectItem value="3">⭐⭐⭐ {t('nStars', { count: 3 })}</SelectItem>
          <SelectItem value="4">⭐⭐⭐⭐ {t('nStars', { count: 4 })}</SelectItem>
          <SelectItem value="5">⭐⭐⭐⭐⭐ {t('nStars', { count: 5 })}</SelectItem>
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
          <SelectItem value="no-rating">{t('noRating')}</SelectItem>
          <SelectItem value="0">☆ {t('nStars', { count: 0 })}</SelectItem>
          <SelectItem value="1">⭐ {t('nStars', { count: 1 })}</SelectItem>
          <SelectItem value="2">⭐⭐ {t('nStars', { count: 2 })}</SelectItem>
          <SelectItem value="3">⭐⭐⭐ {t('nStars', { count: 3 })}</SelectItem>
          <SelectItem value="4">⭐⭐⭐⭐ {t('nStars', { count: 4 })}</SelectItem>
          <SelectItem value="5">⭐⭐⭐⭐⭐ {t('nStars', { count: 5 })}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
} 