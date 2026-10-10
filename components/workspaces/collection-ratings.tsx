"use client";

// An organization's collection rates its papers itself (#655): each member gives a paper their
// own rating there, and the collection sorts and filters by their average. Beside a paper's card:
// your rating there, the average with the first few who rated, and everyone's when opened.

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Star } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { PersonName } from "@/components/ui/identity";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";

type Rater = { id: string; name: string; imageUrl?: string; you: boolean; rating: number };
/** How a paper was rated in a collection, as a page of the library gives it: yours, the first few, and how many rated it. */
export type CollectionRatingsOf = { mine?: number; raters: Rater[]; count: number };

/** Raters the open list reads at a time. */
const RATERS_LISTED = 25;
/** Rows the open list shows before it scrolls, and one row's height with the gap under it. */
const ROWS_SHOWN = 7;
const ROW_PX = 38;

/** `readOnly` is a guest's: they read the collection's ratings and give none in it. */
export function CollectionRatings({ collectionId, libraryItemId, average, ratings, compact = false, readOnly = false }: { collectionId: Id<"collections">; libraryItemId: Id<"libraryItems">; average: number | undefined; ratings: CollectionRatingsOf; compact?: boolean; readOnly?: boolean }) {
  const t = useTranslations("workspaces.ratings");
  const tc = useTranslations("common");
  const rate = useWorkspaceMutation(api.library.collections.setCollectionRating);
  const [busy, setBusy] = useState(false);
  const choose = (rating: number | null) => {
    setBusy(true);
    rate({ collectionId, libraryItemId, rating, expect: ratings.mine ?? null })
      .catch((error) => showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong"))))
      .finally(() => setBusy(false));
  };
  return (
    <span className="flex items-center gap-2 rounded-xl bg-inset py-0.5 pl-2.5 pr-1">
      {compact ? null : <span className="text-xs font-medium text-muted-foreground">{t("collection")}</span>}
      {compact || readOnly ? null : <StarPicker value={ratings.mine ?? null} onChange={choose} label={t("yours")} disabled={busy} />}
      <Raters collectionId={collectionId} libraryItemId={libraryItemId} average={average} ratings={ratings} />
    </span>
  );
}

/** Everyone's ratings of a paper in the collection: their average, who rated, and each rating when opened. */
function Raters({ collectionId, libraryItemId, average, ratings }: { collectionId: Id<"collections">; libraryItemId: Id<"libraryItems">; average: number | undefined; ratings: CollectionRatingsOf }) {
  const t = useTranslations("workspaces.ratings");
  const [open, setOpen] = useState(false);
  const tc = useTranslations("common");
  const workspaceId = useWorkspace();
  // The page gave the first few; the rest are read when the list opens, a page at a time.
  const more = ratings.count > ratings.raters.length;
  const all = usePaginatedQuery(api.library.collections.raters, inWorkspace(workspaceId, open && more ? { collectionId, libraryItemId } : "skip"), { initialNumItems: RATERS_LISTED });
  const loaded = all.status !== "LoadingFirstPage" && all.results.length > 0;
  const listed = loaded ? all.results : ratings.raters;
  if (!ratings.raters.length) return <span className="px-2 text-xs text-muted-foreground">{t("none")}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
          {more ? <span className="text-2xs tabular-nums text-muted-foreground">+{ratings.count - ratings.raters.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-2xl p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">{t("heading")}</p>
        {/* As tall as everyone's ratings from the first frame, up to a few rows and then it scrolls, so the list doesn't grow as it arrives. */}
        <div className="overflow-y-auto" style={{ height: Math.min(ratings.count, ROWS_SHOWN) * ROW_PX - 2 }}>
          <ul className={cn("space-y-0.5", more && !loaded && "opacity-60")}>
            {[...listed].sort((a, b) => b.rating - a.rating).map((rater) => (
              <li key={rater.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
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

/** Five stars to pick from; picking the current one clears it. */
function StarPicker({ value, onChange, label, disabled }: { value: number | null; onChange: (value: number | null) => void; label: string; disabled: boolean }) {
  const t = useTranslations("workspaces.ratings");
  return (
    <span role="radiogroup" aria-label={label} className="flex shrink-0">
      {Array.from({ length: 5 }, (_, i) => {
        const star = i + 1;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={t("stars", { value: star })}
            disabled={disabled}
            onClick={() => onChange(value === star ? null : star)}
            className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:opacity-60"
          >
            <Star className={cn("size-3.5", value !== null && star <= value ? "fill-rating text-rating" : "text-muted-foreground/45")} />
          </button>
        );
      })}
    </span>
  );
}
