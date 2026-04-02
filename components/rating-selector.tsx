"use client";

import React from 'react';
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
        <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
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
import { trimPaperData, type WorkInput } from "@/lib/library/trim-paper-data";
import { useAuthReadiness } from "@/components/providers/convex-provider";

interface RatingSelectorProps {
  paperId: string;
  paperResult?: WorkInput;
  variant?: "default" | "compact";
}

export function RatingSelector({ paperId, paperResult, variant = "default" }: RatingSelectorProps) {
  const t = useTranslations('rating');
  const { setRating } = useRatingsStore();
  const currentRating = useEffectiveRating(paperId);
  const { phase } = useAuthReadiness();
  const saveToLibrary = useMutation(api.library.mutations.saveToLibrary);
  const removeFromLibrary = useMutation(api.library.mutations.removeFromLibraryByOpenalexId);

  const handleRatingChange = (rating: string) => {
    const previousRating = currentRating;
    const newRating = rating === "no-rating" ? null : parseInt(rating);

    // 1. ALWAYS update Zustand (optimistic, localStorage) -- unconditional
    if (rating === "no-rating") {
      setRating(paperId, null);
    } else {
      setRating(paperId, parseInt(rating));
    }

    // 2. If signed-in: save to library on rate, remove from library on clear
    if (phase === "authenticated") {
      if (newRating !== null && paperResult) {
        const trimmed = trimPaperData(paperResult);
        saveToLibrary({
          ...trimmed,
          rating: newRating,
          paperData: JSON.stringify(paperResult),
        }).catch((error) => {
          console.error("[Library] Failed to save to library:", error);
        });
      } else if (newRating === null) {
        removeFromLibrary({ openalexId: paperId }).catch((error) => {
          console.error("[Library] Failed to remove from library:", error);
        });
      }
    }

    // 3. PostHog tracking
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
        <SelectTrigger className="h-8 w-auto min-w-[4rem] px-2">
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