"use client";

// How an organization's members rated a paper, beside its card. In a collection of theirs, which
// rates its papers itself (#655): the average there with the first few who rated. In the library
// outside a collection (#801): the members' average of their own ratings, under the organization's
// mark. Either opens each member's rating. The card's own rating control sets the person's.

import { useState, type ReactNode } from "react";
import { usePaginatedQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Star } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { WorkspaceTile, type WorkspaceLook } from "@/components/workspaces/parts";
import { PersonName } from "@/components/ui/identity";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";

type Rater = { id: string; name: string; imageUrl?: string; you: boolean; rating: number };
/** How a paper was rated, as a page of the library gives it: the first few who rated it and how many did, and in a collection the person's own rating there. */
export type RatingsOf = { mine?: number; raters: Rater[]; count: number };

/** Raters the open list reads at a time. */
const RATERS_LISTED = 25;
/** Rows the open list shows before it scrolls, and one row's height with the gap under it. */
const ROWS_SHOWN = 7;
const ROW_PX = 38;

/**
 * How a member gives a paper their rating in a collection. The cards' own rating control calls it
 * while a collection is open (components/rating-selector.tsx), so there is one way to rate there.
 */
export function useRateInCollection(collectionId: Id<"collections"> | undefined) {
  const tc = useTranslations("common");
  const rate = useWorkspaceMutation(api.library.collections.setCollectionRating);
  // No `expect`: a second choice made before the first one is back is the one that stands.
  return (libraryItemId: Id<"libraryItems">, rating: number | null) => {
    if (!collectionId) return;
    rate({ collectionId, libraryItemId, rating }).catch((error) => showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong"))));
  };
}

/** Everyone's ratings of a paper in the open collection: their average and who rated, with each rating behind it. */
export function CollectionRatings({ collectionId, libraryItemId, average, ratings }: { collectionId: Id<"collections">; libraryItemId: Id<"libraryItems">; average: number | undefined; ratings: RatingsOf }) {
  const t = useTranslations("workspaces.ratings");
  const more = ratings.count - ratings.raters.length;
  return (
    <span className="flex items-center rounded-xl bg-inset p-0.5">
      {ratings.raters.length ? (
        <RatersList heading={t("heading")} paper={{ collectionId, libraryItemId }} ratings={ratings}>
          <button type="button" aria-label={t("everyone")} className="flex h-7 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-muted">
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
              <Star className="size-3.5 fill-rating text-rating" />
              {average === undefined ? null : average.toFixed(1)}
            </span>
            <span className="flex -space-x-1.5">
              {ratings.raters.map((rater) => (
                <span key={rater.id} className="flex rounded-full ring-2 ring-(--color-inset)">
                  <IdentityAvatar name={rater.name} imageUrl={rater.imageUrl} className="size-5" />
                </span>
              ))}
            </span>
            {more > 0 ? <span className="text-2xs tabular-nums text-muted-foreground">+{more}</span> : null}
          </button>
        </RatersList>
      ) : (
        <span className="px-2 text-xs text-muted-foreground">{t("none")}</span>
      )}
    </span>
  );
}

/**
 * In an organization's library outside a collection: its members' average of their own ratings of a
 * paper, under the organization's mark, with each member's rating behind it. The library sorts and
 * filters by this number.
 */
export function MembersAverage({ workspace, libraryItemId, average, ratings }: { workspace: WorkspaceLook; libraryItemId: Id<"libraryItems">; average: number; ratings: RatingsOf }) {
  const t = useTranslations("workspaces.ratings");
  return (
    <span className="flex items-center rounded-xl bg-inset p-0.5">
      <RatersList heading={t("headingIn", { organization: workspace.name })} paper={{ libraryItemId }} ratings={ratings}>
        <button type="button" aria-label={t("average", { organization: workspace.name, average: average.toFixed(1) })} className="flex h-7 items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-muted">
          <WorkspaceTile workspace={workspace} size="xs" />
          <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
            <Star className="size-3.5 fill-rating text-rating" />
            {average.toFixed(1)}
          </span>
        </button>
      </RatersList>
    </span>
  );
}

/**
 * Each member's rating of a paper, opened from `children`: in a collection when `paper` names one,
 * else their own ratings of it. The page gave the first few; the rest are read when the list opens,
 * a page at a time.
 */
function RatersList({ heading, paper, ratings, children }: { heading: string; paper: { collectionId?: Id<"collections">; libraryItemId: Id<"libraryItems"> }; ratings: RatingsOf; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tc = useTranslations("common");
  const workspaceId = useWorkspace();
  const more = ratings.count > ratings.raters.length;
  const all = usePaginatedQuery(api.library.collections.raters, inWorkspace(workspaceId, open && more ? paper : "skip"), { initialNumItems: RATERS_LISTED });
  const loaded = open && more && all.status !== "LoadingFirstPage";
  // The ones the page gave stay, and the ones read since join them: a page of the rest can come back with none of them, when the
  // ratings it read were other people's, and then there is still more to ask for.
  const listed = loaded ? [...ratings.raters, ...all.results.filter((rater) => !ratings.raters.some((first) => first.id === rater.id))] : ratings.raters;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-2xl p-2">
        <p className="truncate px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">{heading}</p>
        {/* As tall as everyone's ratings from the first frame, up to a few rows and then it scrolls, so the list doesn't grow as it arrives. */}
        <div className="overflow-y-auto" style={{ height: Math.min(ratings.count, ROWS_SHOWN) * ROW_PX - 2 }}>
          <ul className={cn("space-y-0.5 transition-opacity duration-200", more && !loaded && "opacity-60")}>
            {[...listed].sort((a, b) => b.rating - a.rating).map((rater) => (
              // The ones read once the list opened fade in beside the ones the page already had.
              <li key={rater.id} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", !ratings.raters.some((first) => first.id === rater.id) && "animate-in fade-in-0 duration-200")}>
                <IdentityAvatar name={rater.name} imageUrl={rater.imageUrl} className="size-6" />
                <PersonName name={rater.name} you={rater.you} className="flex-1 text-sm" />
                <Stars value={rater.rating} />
              </li>
            ))}
            {loaded && (all.status === "CanLoadMore" || all.status === "LoadingMore") ? (
              <li>
                <button type="button" disabled={all.status === "LoadingMore"} onClick={() => all.loadMore(RATERS_LISTED)} className="flex h-9 w-full items-center justify-center rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
                  {tc("showMore")}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Stars({ value }: { value: number }) {
  const t = useTranslations("workspaces.ratings");
  return (
    <span className="flex shrink-0" aria-label={t("stars", { value })}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn("size-3", i < value ? "fill-rating text-rating" : "text-muted-foreground/35")} />
      ))}
    </span>
  );
}
