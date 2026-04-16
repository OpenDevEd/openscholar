"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Unplug, ExternalLink } from "lucide-react";
import { useAction } from "convex/react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ZoteroItemRow,
  type ZoteroItemForUI,
  type ResolutionState,
} from "./zotero-item-row";
import Link from "next/link";

export function ZoteroTab() {
  const t = useTranslations("extraction.zoteroTab");
  const { data: status } = useProtectedQuery(
    api.zotero.queries.getConnectionStatus,
    {},
  );
  const fetchCollections = useAction(api.zotero.actions.fetchCollections);
  const fetchItemsAction = useAction(api.zotero.actions.fetchItems);
  const resolveByDoi = useAction(api.openalex.actions.resolveByDoi);
  const { addToBasket, isInBasket } = useAddToBasket();

  // Collection picker state (D-05)
  const [collections, setCollections] = useState<
    Array<{ key: string; name: string; numItems?: number }>
  >([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  ); // null = All Items
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  // Items pagination state (D-06)
  const [items, setItems] = useState<ZoteroItemForUI[]>([]);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Per-item DOI resolution state (D-09, D-10)
  // itemStates: Map<itemKey, ResolutionState>
  const [itemStates, setItemStates] = useState<Map<string, ResolutionState>>(
    new Map(),
  );
  // resolvedCacheRef: Map<doi, openalexId | null> — keyed by DOI, NOT by item key (Pitfall 5)
  const resolvedCacheRef = useRef(new Map<string, string | null>());

  // Load collections when connected (Section 2)
  useEffect(() => {
    if (!status?.connected) return;

    let cancelled = false;
    setCollectionsLoading(true);

    fetchCollections({})
      .then((result) => {
        if (!cancelled) setCollections(result);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("loadCollectionsError"));
      })
      .finally(() => {
        if (!cancelled) setCollectionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status?.connected, fetchCollections, t]);

  // Load items function (Section 3)
  const loadItems = useCallback(
    async (start: number) => {
      setItemsLoading(true);
      try {
        const result = await fetchItemsAction({
          collectionKey: selectedCollection ?? undefined,
          start,
          limit: 25, // D-06: always pass 25 explicitly — default in action is 50 (Pitfall 3)
        });
        setItems((prev) => (start === 0 ? result.items : [...prev, ...result.items]));
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch {
        toast.error(t("loadItemsError"));
      } finally {
        setItemsLoading(false);
      }
    },
    [fetchItemsAction, selectedCollection, t],
  );

  // Reset and reload items when collection changes (or on initial connected mount)
  useEffect(() => {
    if (!status?.connected) return;
    setItems([]);
    setNextCursor(undefined);
    setHasMore(false);
    void loadItems(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, selectedCollection]);

  // DOI resolution handlers (Section 4) — D-09, D-10
  const handleResolve = useCallback(
    async (itemKey: string, doi: string) => {
      const cache = resolvedCacheRef.current;

      // Check cache first (D-10) — cache key is DOI, not item key (Pitfall 5)
      if (cache.has(doi)) {
        const cachedId = cache.get(doi);
        if (cachedId) {
          const item = items.find((i) => i.key === itemKey);
          if (item) {
            addToBasket({ rawId: cachedId, title: item.title, doi, source: "zotero" });
            setItemStates((prev) => new Map(prev).set(itemKey, "resolved"));
          }
        } else {
          // Previously failed — show failed state without another API call
          setItemStates((prev) => new Map(prev).set(itemKey, "failed"));
        }
        return;
      }

      // Not in cache — call resolveByDoi
      setItemStates((prev) => new Map(prev).set(itemKey, "resolving"));
      try {
        const result = await resolveByDoi({ doi });
        if (result) {
          cache.set(doi, result.openalexId);
          addToBasket({
            rawId: result.openalexId,
            title: result.title,
            doi: result.doi ?? null,
            source: "zotero",
          });
          setItemStates((prev) => new Map(prev).set(itemKey, "resolved"));
        } else {
          cache.set(doi, null); // null = not found in OpenAlex
          setItemStates((prev) => new Map(prev).set(itemKey, "failed"));
        }
      } catch {
        cache.set(doi, null);
        setItemStates((prev) => new Map(prev).set(itemKey, "failed"));
      }
    },
    [resolveByDoi, addToBasket, items],
  );

  const handleRetry = useCallback(
    (itemKey: string, doi: string) => {
      // Clear the cached failure before retrying (D-10)
      resolvedCacheRef.current.delete(doi);
      setItemStates((prev) => new Map(prev).set(itemKey, "idle"));
      void handleResolve(itemKey, doi);
    },
    [handleResolve],
  );

  const handleCollectionChange = useCallback((value: string) => {
    setSelectedCollection(value === "__all__" ? null : value);
  }, []);

  // Render: loading state (status not yet available)
  if (status === undefined) {
    return (
      <div className="flex items-center justify-center py-12 min-h-[30vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Render: disconnected empty state (D-04, D-07 empty state link)
  if (!status.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 min-h-[30vh]">
        <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
          <Unplug className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold">{t("notConnectedHeading")}</p>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          {t("notConnectedBody")}
        </p>
        <Link
          href="/settings/connections"
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          {t("goToSettings")}
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  // Render: connected state (D-04 through D-11)
  return (
    <div className="space-y-4">
      {/* Collection picker — D-05 */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium whitespace-nowrap shrink-0">
          {t("collectionLabel")}
        </label>
        {collectionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loadingCollections")}
          </div>
        ) : (
          <Select
            value={selectedCollection ?? "__all__"}
            onValueChange={handleCollectionChange}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("allItems")}</SelectItem>
              {collections.map((col) => (
                <SelectItem key={col.key} value={col.key}>
                  {col.name}
                  {col.numItems != null ? ` (${col.numItems})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Items list — D-06 */}
      {itemsLoading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 && !itemsLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-sm font-semibold">{t("noItemsHeading")}</p>
          <p className="text-sm text-muted-foreground">{t("noItemsBody")}</p>
        </div>
      ) : (
        <>
          <div className="divide-y">
            {items.map((item) => {
              const resState = itemStates.get(item.key) ?? "idle";
              // An item is "in basket" if: resolution state is "resolved",
              // OR the DOI resolves to an ID that is already in the basket from a prior session
              const cachedId = item.doi
                ? resolvedCacheRef.current.get(item.doi)
                : undefined;
              const inBasket =
                resState === "resolved" ||
                (cachedId != null && cachedId !== null && isInBasket(cachedId));
              return (
                <ZoteroItemRow
                  key={item.key}
                  item={item}
                  resolutionState={resState}
                  onResolve={handleResolve}
                  onRetry={handleRetry}
                  isInBasket={inBasket}
                />
              );
            })}
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {t("showing", { count: items.length, total: items.length })}
            </p>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadItems(nextCursor ?? items.length)}
                disabled={itemsLoading}
                className="ml-auto"
              >
                {itemsLoading && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                {t("loadMore")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
