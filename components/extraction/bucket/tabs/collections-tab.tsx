"use client";

import { useMemo, useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Folder, Loader2, Plus } from "lucide-react";
import { SelectableList } from "../selectable-list";
import { useBucketStore } from "@/lib/store/bucket";
import { fromCollectionItem } from "@/lib/bucket/bucketItem";

type LibItem = Doc<"libraryItems">;

export function CollectionsTab() {
  const collections = useQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<Id<"collections"> | null>(null);

  const addMany = useBucketStore((s) => s.addMany);
  const bucketKeys = useBucketStore((s) => new Set(s.order));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-muted/20 p-2">
        {collections === undefined ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : collections.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            You don't have any collections yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {collections.map((c) => {
              const active = c._id === selectedCollectionId;
              return (
                <li key={c._id}>
                  <button
                    type="button"
                    onClick={() => setSelectedCollectionId(c._id)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.itemCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section>
        {selectedCollectionId ? (
          <CollectionItems
            collectionId={selectedCollectionId}
            bucketKeys={bucketKeys}
            onAdd={(items, collectionId) => {
              addMany(items.map((item) => fromCollectionItem(item, collectionId)));
            }}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Pick a collection on the left to see its papers.
          </div>
        )}
      </section>
    </div>
  );
}

function CollectionItems({
  collectionId,
  bucketKeys,
  onAdd,
}: {
  collectionId: Id<"collections">;
  bucketKeys: Set<string>;
  onAdd: (items: LibItem[], collectionId: Id<"collections">) => void;
}) {
  const list = usePaginatedQuery(
    api.extraction.sources.collections.listItems,
    { collectionId },
    { initialNumItems: 30 },
  );

  const isSelected = useMemo(
    () => (item: LibItem) => {
      const key = fromCollectionItem(item, collectionId).bucketKey;
      return bucketKeys.has(key);
    },
    [bucketKeys, collectionId],
  );

  if (list.status === "LoadingFirstPage") {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading items…
      </div>
    );
  }

  const items = list.results ?? [];
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        This collection is empty.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAdd(items, collectionId)}
        >
          <Plus className="h-4 w-4 mr-1" /> Add all visible
        </Button>
      </div>
      <SelectableList<LibItem>
        items={items}
        keyOf={(i) => i._id}
        isSelected={isSelected}
        onToggle={(item) => onAdd([item], collectionId)}
        onToggleAll={() => onAdd(items, collectionId)}
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
