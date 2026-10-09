"use client";

/**
 * More like the papers rated 4 or 5 among the results the list keeps, on any of its pages: a search
 * for the works nearest them by meaning (the OpenScholar API's similar_to), closest first. Shown only
 * when there are some.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useSearchOptional } from "@/lib/search";
import { createSimilarSearch } from "@/lib/search/actions";
import { useRatingsStore } from "@/lib/store";
import { ratingFilterKeeps } from "@/lib/utils";

/** The least rating that marks a paper as one to find more like. */
export const LIKED_RATING = 4;

export function MoreLikeRated() {
  const t = useTranslations("searchCommand");
  const router = useRouter();
  const search = useSearchOptional();
  const ratings = useRatingsStore((state) => state.ratings);
  if (!search) return null;
  const { rmin, rmax, rated } = search.params;
  // The list's rating filter can hide some of them.
  const liked = search.results
    .filter((paper) => (ratings[paper.id] ?? 0) >= LIKED_RATING && ratingFilterKeeps(ratings[paper.id], [rmin, rmax], rated))
    .map((paper) => paper.id);
  if (liked.length === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
      onClick={() => router.push(createSimilarSearch(liked).url)}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {t("moreLikeRated", { count: liked.length })}
    </Button>
  );
}
