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

/**
 * The choices. Radix names an option, and the trigger showing it, by the option's own text, and the stars are
 * pictures: each says its rating in text only screen readers read.
 */
function RatingItems() {
  const t = useTranslations('rating');
  return (
    <>
      <SelectItem value="no-rating"><NoRatingDisplay /><span className="sr-only">{t('noRating')}</span></SelectItem>
      {[0, 1, 2, 3, 4, 5].map((count) => (
        <SelectItem key={count} value={String(count)}><RatingStarsDisplay count={count} /><span className="sr-only">{t('nStars', { count })}</span></SelectItem>
      ))}
    </>
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
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
      setLibraryRating({ paper: paper.id, rating: null }).catch((error) => {
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
        <SelectTrigger size="sm" className={cn("w-auto min-w-[4rem] shrink-0 px-2", collection && "rounded-l-none shadow-none")}>
          <SelectValue placeholder={t('noRating')} />
        </SelectTrigger>
        <SelectContent>
          <RatingItems />
        </SelectContent>
      </Select>
    );
    if (!collection) return select;
    return (
      // Whose rating this is: the collection's name, joined to the control as its left half, the way Saved is joined to its collections.
      // The name gives way when the row is tight, and shows in full on hover while it's cut off.
      <span className="inline-flex min-w-0 max-w-full rounded-md shadow-xs">
        <TooltipHint label={collection.name} onlyWhenClipped>
          {/* In a narrow card (a three-column grid's, a phone's) the name has no room beside Saved: the folder stands for it there, and hovering names it. */}
          <span className="inline-flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-l-md border border-r-0 border-input bg-inset px-2 text-xs font-medium text-muted-foreground @max-[24rem]/card:gap-0">
            <Folder className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate @max-[24rem]/card:w-0">{collection.name}</span>
          </span>
        </TooltipHint>
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
          <RatingItems />
        </SelectContent>
      </Select>
    </div>
  );
} 