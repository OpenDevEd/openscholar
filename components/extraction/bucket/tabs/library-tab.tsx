"use client";

import { useMemo, useState } from "react";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { SelectableList } from "../selectable-list";
import { useBucketStore } from "@/lib/store/bucket";
import { fromLibraryItem } from "@/lib/bucket/bucketItem";
import type { BucketSource } from "@/lib/bucket/bucketItem";
import { buildDedupeKey } from "@/lib/bucket/dedupe";
import { BUCKET_SOURCE_LABELS } from "@/lib/bucket/source-labels";
import { bucketAdded } from "@/lib/toast/bucket";
import type { Doc } from "@/convex/_generated/dataModel";

type LibItem = Doc<"libraryItems">;

export function LibraryTab() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState<string | undefined>(undefined);

  const list = usePaginatedQuery(
    api.extraction.sources.library.list,
    { query },
    { initialNumItems: 30 },
  );

  const convex = useConvex();
  const limit = useQuery(api.extraction.bucket.queries.getMyPaperLimit) ?? 1000;
  const addMany = useBucketStore((s) => s.addMany);
  const removeMany = useBucketStore((s) => s.removeMany);
  const order = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(order), [order]);
  // Cross-source "also staged from X" hint: atomic selectors per P5 §5a.
  const dedupeKeys = useBucketStore((s) => s.dedupeKeys);
  const dedupeKeyToSource = useBucketStore((s) => s.dedupeKeyToSource);

  const alsoStagedFrom = (item: LibItem): BucketSource | null => {
    const bucketKey = fromLibraryItem(item).bucketKey;
    if (bucketKeys.has(bucketKey)) return null;
    try {
      const weakKey = buildDedupeKey({
        doi: item.doi,
        title: item.title,
        year: item.publicationYear,
      });
      if (!dedupeKeys.has(weakKey)) return null;
      const src = dedupeKeyToSource[weakKey];
      return src && src !== "library" ? src : null;
    } catch {
      return null;
    }
  };

  const isSelected = useMemo(
    () => (item: LibItem) => {
      const key = fromLibraryItem(item).bucketKey;
      return bucketKeys.has(key);
    },
    [bucketKeys],
  );

  const toggle = (item: LibItem, next: boolean) => {
    const bucketItem = fromLibraryItem(item);
    if (next) bucketAdded(addMany([bucketItem], limit), { silent: true });
    else removeMany([bucketItem.bucketKey]);
  };

  const toggleAll = (next: boolean) => {
    const rows = list.results ?? [];
    const bucketItems = rows.map((r) => fromLibraryItem(r));
    if (next) bucketAdded(addMany(bucketItems, limit));
    else removeMany(bucketItems.map((b) => b.bucketKey));
  };

  const toggleRange = (rows: LibItem[], next: boolean) => {
    const bucketItems = rows.map((r) => fromLibraryItem(r));
    if (next) bucketAdded(addMany(bucketItems, limit));
    else removeMany(bucketItems.map((b) => b.bucketKey));
  };

  const selectAllAcross = async () => {
    const res = await convex.query(
      api.extraction.sources.library.listAllIds,
      { query },
    );
    const result = addMany(
      res.items.map((r) => fromLibraryItem(r)),
      limit,
    );
    bucketAdded({ ...result, truncated: res.truncated });
  };

  return (
    <div className="space-y-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(searchInput.trim() || undefined);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search your library"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
      </form>

      {list.status === "LoadingFirstPage" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your library…
        </div>
      ) : (list.results ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center border border-border rounded-xl bg-muted/30">
          {query
            ? "No library items match your search."
            : "Your library is empty. Rate papers from search to save them here."}
        </p>
      ) : (
        <SelectableList<LibItem>
          items={list.results ?? []}
          keyOf={(item) => item._id}
          isSelected={isSelected}
          onToggle={toggle}
          onToggleRange={toggleRange}
          onToggleAll={toggleAll}
          onSelectAllAcross={selectAllAcross}
          hasMore={list.status === "CanLoadMore"}
          renderRow={(item) => {
            const alsoFrom = alsoStagedFrom(item);
            return (
              <div>
                <p className="font-medium text-sm truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.authors ?? "Unknown authors"}
                  {item.publicationYear ? ` · ${item.publicationYear}` : ""}
                </p>
                {alsoFrom && (
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                    Also staged from {BUCKET_SOURCE_LABELS[alsoFrom]}
                  </p>
                )}
              </div>
            );
          }}
        />
      )}

      {list.status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.loadMore(30)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
