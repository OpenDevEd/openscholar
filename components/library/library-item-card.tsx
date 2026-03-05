"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  LibraryItemActions,
  LibraryMetadataPills,
  LibraryRatingStars,
} from "./library-item-shared";

interface LibraryItemCardProps {
  item: Doc<"libraryItems">;
  onRemove: (item: Doc<"libraryItems">) => void;
  onAddToCollection: (item: Doc<"libraryItems">) => void;
}

export function LibraryItemCard({
  item,
  onRemove,
  onAddToCollection,
}: LibraryItemCardProps) {
  return (
    <article
      className={cn(
        "group rounded-2xl border p-4 transition-all duration-200",
        "bg-background/95 dark:bg-background/90",
        "border-border/60 dark:border-border/40",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
        "hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-xl hover:shadow-black/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <LibraryRatingStars rating={item.rating} />
        <LibraryItemActions
          item={item}
          onRemove={onRemove}
          onAddToCollection={onAddToCollection}
        />
      </div>

      <div className="mt-3 space-y-3">
        <div className="space-y-2 min-w-0">
          <h3 className="text-sm font-semibold leading-snug text-foreground line-clamp-3">
            {item.title}
          </h3>
          {item.authors && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {item.authors}
            </p>
          )}
        </div>

        <LibraryMetadataPills item={item} compact />

        {item.abstract && (
          <p className="text-xs leading-6 text-muted-foreground line-clamp-4">
            {item.abstract}
          </p>
        )}
      </div>
    </article>
  );
}
