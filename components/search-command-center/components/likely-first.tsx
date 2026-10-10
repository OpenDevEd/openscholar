"use client";

/**
 * Likely relevant first: the search's results ordered by the papers rated so far, closest first to
 * those rated 4 or 5 and furthest from those rated 1 or 2, as the OpenScholar API orders works by
 * closeness, with the papers not rated yet first (lib/search/likely-order.ts). Shown once a result is
 * rated 4 or 5, pressed while the order holds, when a press puts the search's own order back, and with
 * a way to order again once the ratings have changed. The order stays put while the person rates, so
 * the paper they are reading doesn't move.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getClosenessOrder } from "@/app/actions/openalex";
import { shortWorkId } from "@/lib/openalex/work-id";
import { useSearchOptional } from "@/lib/search";
import { likelyOrder, resultsKey, sameSeeds, seedsOf, useLikelyOrderStore } from "@/lib/search/likely-order";
import { useRatingsStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";

const QUIET = "h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground";

export function LikelyFirst() {
  const t = useTranslations("searchCommand");
  const toast = useAppToast();
  const search = useSearchOptional();
  const ratings = useRatingsStore((state) => state.ratings);
  const searchId = search?.searchId;
  const order = useLikelyOrderStore((state) => (searchId ? state.orders[searchId] : undefined));
  const setOrder = useLikelyOrderStore((state) => state.setOrder);
  const clearOrder = useLikelyOrderStore((state) => state.clearOrder);
  const [ordering, setOrdering] = useState(false);
  if (!search || !searchId) return null;
  const papers = search.results;
  const key = resultsKey(papers);
  const seeds = seedsOf(papers, ratings);
  const current = order?.key === key ? order : undefined;
  // The OpenScholar API alone orders works by closeness; its works are OS ones, OpenAlex's W ones.
  const ours = papers.some((paper) => shortWorkId(paper.id)?.startsWith("OS"));
  if (!ours || (!current && seeds.liked.length === 0)) return null;

  const orderNow = async () => {
    setOrdering(true);
    // From the first page, as the person asks: an answer that comes after the results changed moves nothing.
    search.setPage(1);
    try {
      const works = papers.map((paper) => shortWorkId(paper.id) ?? paper.id);
      const answer = await getClosenessOrder(works, seeds.liked, seeds.disliked);
      if (!answer.ok) {
        toast.error(t("likelyFirstFailed"), answer.message);
        return;
      }
      setOrder(searchId, { key, ids: likelyOrder(answer.order.map((one) => one.id), ratings), seeds });
    } catch {
      toast.error(t("likelyFirstFailed"));
    } finally {
      setOrdering(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant={current ? "secondary" : "ghost"}
        size="sm"
        className={QUIET}
        aria-pressed={Boolean(current)}
        title={t("likelyFirstHint")}
        disabled={ordering}
        onClick={current ? () => clearOrder(searchId) : () => void orderNow()}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {t("likelyFirst")}
      </Button>
      {current && seeds.liked.length > 0 && !sameSeeds(current.seeds, seeds) && (
        <Button type="button" variant="ghost" size="sm" className={QUIET} disabled={ordering} onClick={() => void orderNow()}>
          {t("likelyFirstResort")}
        </Button>
      )}
    </div>
  );
}
