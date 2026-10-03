"use client";

import React, { useCallback } from 'react';
import { Star } from "lucide-react";

function NoRatingDisplay() {
  return (
    <div className="relative shrink-0">
      <Star className="h-3 w-3 text-muted-foreground" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3 h-px bg-muted-foreground rotate-45" />
      </div>
    </div>
  );
}

function RatingStarsDisplay({ count }: { count: number }) {
  if (count === 0) {
    return <Star className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
  return (
    <span className="flex shrink-0">
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} className="h-3 w-3 fill-rating text-rating" />
      ))}
    </span>
  );
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRatingsStore } from "@/lib/store";
import { useEffectiveRating } from "@/components/results-contexts";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { paperArgs } from "@/components/library/save-control";
import { useAuthReadiness } from "@/components/providers/convex-provider";

/**
 * Rates a paper. The rating is kept for the person either way; signed in, rating
 * also saves the paper to the library, and clearing the rating keeps it saved.
 */
export function useRatePaper() {
  const { setRating } = useRatingsStore();
  const { phase } = useAuthReadiness();
  const saveToLibrary = useMutation(api.library.mutations.saveToLibrary);
  const clearLibraryRating = useMutation(api.library.mutations.clearLibraryRating);

  return useCallback((paper: WorkInput, rating: number | null) => {
    setRating(paper.id, rating);
    if (phase !== "authenticated") return;
    if (rating === null) {
      clearLibraryRating({ openalexId: paper.id }).catch((error) => {
        console.error("[Library] Failed to clear rating:", error);
      });
    } else {
      saveToLibrary({ ...paperArgs(paper), rating }).catch((error) => {
        console.error("[Library] Failed to save to library:", error);
      });
    }
  }, [setRating, phase, saveToLibrary, clearLibraryRating]);
}

interface RatingSelectorProps {
  paper: WorkInput;
  variant?: "default" | "compact";
}

export function RatingSelector({ paper, variant = "default" }: RatingSelectorProps) {
  const t = useTranslations('rating');
  const paperId = paper.id;
  const currentRating = useEffectiveRating(paperId);
  const rate = useRatePaper();

  const handleRatingChange = (rating: string) => {
    const previousRating = currentRating;
    const newRating = rating === "no-rating" ? null : parseInt(rating);
    rate(paper, newRating);

    // PostHog tracking
    posthog.capture("paper_rated", {
      paper_id: paperId,
      rating: newRating,
      previous_rating: previousRating ?? null,
      is_rating_removed: rating === "no-rating",
      variant: variant,
    });
  };
  
  // Compact variant for mobile focus mode
  if (variant === "compact") {
    return (
      <Select
        value={currentRating?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger size="sm" className="w-auto min-w-[4rem] px-2">
          <SelectValue placeholder={t('noRating')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating" aria-label={t('noRating')}><NoRatingDisplay /></SelectItem>
          <SelectItem value="0" aria-label={t('nStars', { count: 0 })}><RatingStarsDisplay count={0} /></SelectItem>
          <SelectItem value="1" aria-label={t('nStars', { count: 1 })}><RatingStarsDisplay count={1} /></SelectItem>
          <SelectItem value="2" aria-label={t('nStars', { count: 2 })}><RatingStarsDisplay count={2} /></SelectItem>
          <SelectItem value="3" aria-label={t('nStars', { count: 3 })}><RatingStarsDisplay count={3} /></SelectItem>
          <SelectItem value="4" aria-label={t('nStars', { count: 4 })}><RatingStarsDisplay count={4} /></SelectItem>
          <SelectItem value="5" aria-label={t('nStars', { count: 5 })}><RatingStarsDisplay count={5} /></SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Default variant
  return (
    <div className="flex items-center gap-3 mb-3">
      <Select
        value={currentRating?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger className="min-w-48">
          <SelectValue placeholder={t('noRating')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating" aria-label={t('noRating')}><NoRatingDisplay /></SelectItem>
          <SelectItem value="0" aria-label={t('nStars', { count: 0 })}><RatingStarsDisplay count={0} /></SelectItem>
          <SelectItem value="1" aria-label={t('nStars', { count: 1 })}><RatingStarsDisplay count={1} /></SelectItem>
          <SelectItem value="2" aria-label={t('nStars', { count: 2 })}><RatingStarsDisplay count={2} /></SelectItem>
          <SelectItem value="3" aria-label={t('nStars', { count: 3 })}><RatingStarsDisplay count={3} /></SelectItem>
          <SelectItem value="4" aria-label={t('nStars', { count: 4 })}><RatingStarsDisplay count={4} /></SelectItem>
          <SelectItem value="5" aria-label={t('nStars', { count: 5 })}><RatingStarsDisplay count={5} /></SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
} 