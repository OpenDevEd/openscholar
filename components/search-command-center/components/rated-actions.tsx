"use client";

import { AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowUpDown, Compass, RotateCcw, Target, X } from "@/components/icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { orderByCloseness } from "@/app/actions/similar";
import { Button } from "@/components/ui/button";
import { Opening } from "@/components/ui/opening";
import Link from "@/components/workspace-link";
import { unlessLimited } from "@/lib/openalex/limited";
import { useSearchOptional } from "@/lib/search";
import { similarSearchHref } from "@/lib/search/similar-href";
import { DISLIKED_RATING, LIKED_RATING, MOST_SEEDS, useLikelyOrder } from "@/lib/search/likely-order";
import { useSearchSource } from "@/lib/search/use-search-source";
import { useRatingsStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";

const QUIET = "h-8 gap-1.5 rounded-lg px-2 text-muted-foreground hover:text-foreground";
const shortId = (id: string) => id.split("/").at(-1)!;

/**
 * What the papers rated so far can do, on our index only: find more like the ones rated well, and put the results most
 * like them first. They appear once a paper is rated 4 or 5. A search for similar papers shows what it's similar to here too,
 * on either source, so it can be cleared where OpenAlex can't run it.
 */
export function RatedActions() {
  const t = useTranslations("similarPapers");
  const search = useSearchOptional();
  const source = useSearchSource();
  const toast = useAppToast();
  const { ratings } = useRatingsStore();
  const [ordering, setOrdering] = useState(false);
  const searchId = search?.searchId;
  const kept = useLikelyOrder((state) => (searchId ? state.orders[searchId] : undefined));
  const setOrder = useLikelyOrder((state) => state.set);
  if (!search || !searchId) return null;
  const own = source === "openscholar";
  // An order is our index's: after a switch to OpenAlex it isn't used, and it can't be redone.
  const order = own ? kept : undefined;
  const papers = search.results as Array<{ id: string; openscholar_id?: string }>;
  const rated = (keep: (rating: number) => boolean) => papers.filter((paper) => ratings[paper.id] !== undefined && keep(ratings[paper.id]));
  const liked = own ? rated((rating) => rating >= LIKED_RATING).slice(0, MOST_SEEDS) : [];
  const disliked = rated((rating) => rating <= DISLIKED_RATING).slice(0, MOST_SEEDS);
  const like = search.params.like;
  const shown = liked.length > 0 || Boolean(order) || like.length > 0;
  const madeFrom = JSON.stringify(papers.filter((paper) => ratings[paper.id] !== undefined).map((paper) => [paper.id, ratings[paper.id]]));
  const changed = order !== undefined && order.ratings !== madeFrom && liked.length > 0;

  const orderNow = async () => {
    setOrdering(true);
    search.setPage(1);
    try {
      const ownId = (paper: { id: string; openscholar_id?: string }) => shortId(paper.openscholar_id ?? paper.id);
      const closest = await unlessLimited(orderByCloseness(papers.map(ownId), liked.map(ownId), disliked.map(ownId)));
      const byOwn = new Map(papers.map((paper) => [ownId(paper), paper.id]));
      const ids = closest.flatMap((id) => byOwn.get(id) ?? []);
      // Papers not rated yet first, the likeliest first: the rest have had their turn. It stays put while you rate.
      setOrder(searchId, { ids: [...ids.filter((id) => ratings[id] === undefined), ...ids.filter((id) => ratings[id] !== undefined)], ratings: madeFrom });
    } catch (error) {
      console.error("[search] couldn't order the results", error);
      toast.error(t("orderFailed"));
    } finally {
      setOrdering(false);
    }
  };

  // It opens its own row below the count, so what's beside the count never moves.
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <Opening key="rated">
          <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5">
            {like.length > 0 && (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inset ps-2.5 pe-1 text-sm text-muted-foreground">
                <Compass className="h-3.5 w-3.5" />
                {t("similarTo", { count: like.length })}
                <TooltipHint label={t("clear")}>
                  <Button type="button" variant="ghost" size="icon" className="size-6 rounded-md" aria-label={t("clear")} onClick={() => search.updateParams({ like: [], page: 1 })}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipHint>
              </span>
            )}
            {liked.length > 0 && (
              <Button variant="ghost" size="sm" className={QUIET} asChild>
                <Link href={similarSearchHref(liked.map((paper) => paper.id)) ?? "/results"}>
                  <Target className="h-3.5 w-3.5" />
                  {t("moreLike", { count: liked.length })}
                </Link>
              </Button>
            )}
            {(liked.length > 0 || order) && (
              <Button type="button" variant={order ? "secondary" : "ghost"} size="sm" className={QUIET} aria-pressed={Boolean(order)} disabled={ordering} onClick={order ? () => setOrder(searchId, null) : () => void orderNow()}>
                <ArrowUpDown className="h-3.5 w-3.5" />
                {t("likelyFirst")}
              </Button>
            )}
            {changed && (
              <Button type="button" variant="ghost" size="sm" className={QUIET} disabled={ordering} onClick={() => void orderNow()}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("resort")}
              </Button>
            )}
          </div>
        </Opening>
      )}
    </AnimatePresence>
  );
}
