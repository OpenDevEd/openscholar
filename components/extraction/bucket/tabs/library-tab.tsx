"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { SelectableList } from "../selectable-list";
import { useBucketStore } from "@/lib/store/bucket";
import { fromLibraryItem } from "@/lib/bucket/bucketItem";
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

  const addMany = useBucketStore((s) => s.addMany);
  const removeMany = useBucketStore((s) => s.removeMany);
  const order = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(order), [order]);

  const isSelected = useMemo(
    () => (item: LibItem) => {
      const key = fromLibraryItem(item).bucketKey;
      return bucketKeys.has(key);
    },
    [bucketKeys],
  );

  const toggle = (item: LibItem, next: boolean) => {
    const bucketItem = fromLibraryItem(item);
    if (next) addMany([bucketItem]);
    else removeMany([bucketItem.bucketKey]);
  };

  const toggleAll = (next: boolean) => {
    const rows = list.results ?? [];
    const bucketItems = rows.map((r) => fromLibraryItem(r));
    if (next) addMany(bucketItems);
    else removeMany(bucketItems.map((b) => b.bucketKey));
  };

  const toggleRange = (rows: LibItem[], next: boolean) => {
    const bucketItems = rows.map((r) => fromLibraryItem(r));
    if (next) addMany(bucketItems);
    else removeMany(bucketItems.map((b) => b.bucketKey));
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
          renderRow={(item) => (
            <div>
              <p className="font-medium text-sm truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {item.authors ?? "Unknown authors"}
                {item.publicationYear ? ` · ${item.publicationYear}` : ""}
              </p>
            </div>
          )}
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
