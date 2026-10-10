"use client";

import React, { useCallback, useContext } from 'react';
import { Folder, Star } from "@/components/icons";

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
import { CollectionRatingContext, useEffectiveRating } from "@/components/results-contexts";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { WorkInput } from "@/lib/library/trim-paper-data";
import { paperArgs } from "@/components/library/save-control";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useWorkspaceMutation } from "@/lib/workspaces/url";

/**
 * Rates a paper. The rating is kept for the person either way; signed in, rating
 * also saves the paper to the library, and clearing the rating keeps it saved.
 */
export function useRatePaper() {
  const { setRating } = useRatingsStore();
  const { phase } = useAuthReadiness();
  const saveToLibrary = useWorkspaceMutation(api.library.mutations.saveToLibrary);
  const setLibraryRating = useWorkspaceMutation(api.library.mutations.setLibraryRating);

  return useCallback((paper: WorkInput, rating: number | null) => {
    setRating(paper.id, rating);
    if (phase !== "authenticated") return;
    if (rating === null) {
      setLibraryRating({ openalexId: paper.id, rating: null }).catch((error) => {
        console.error("[Library] Failed to clear rating:", error);
      });
    } else {
      saveToLibrary({ ...paperArgs(paper), rating }).catch((error) => {
        console.error("[Library] Failed to save to library:", error);
      });
    }
  }, [setRating, phase, saveToLibrary, setLibraryRating]);
}

interface RatingSelectorProps {
  paper: WorkInput;
  variant?: "default" | "compact";
}

export function RatingSelector({ paper, variant = "default" }: RatingSelectorProps) {
  const t = useTranslations('rating');
  const paperId = paper.id;
  // In an open collection whose members rate in it, this is the person's rating there, and it's set there.
  const collection = useContext(CollectionRatingContext);
  const ownRating = useEffectiveRating(paperId);
  const currentRating = collection ? (collection.ratings.get(paperId) ?? undefined) : ownRating;
  const rate = useRatePaper();

  const handleRatingChange = (rating: string) => {
    const previousRating = currentRating;
    const newRating = rating === "no-rating" ? null : parseInt(rating);
    if (collection) collection.rate(paperId, newRating);
    else rate(paper, newRating);

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
    const select = (
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
    if (!collection) return select;
    return (
      <span className="relative inline-flex">
        {/* Whose rating this is: the collection's name, on the control's top edge. It takes no room in the row. */}
        <span className="pointer-events-none absolute -top-2.5 left-1.5 z-10 inline-flex h-4 max-w-40 items-center gap-1 rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
          <Folder className="size-2.5 shrink-0" />
          <span className="min-w-0 truncate">{collection.name}</span>
        </span>
        {select}
      </span>
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