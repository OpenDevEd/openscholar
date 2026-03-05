"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  LibraryItemActions,
  LibraryMetadataPills,
  LibraryRatingStars,
} from "./library-item-shared";

interface LibraryItemRowProps {
  item: Doc<"libraryItems">;
  onRemove: (item: Doc<"libraryItems">) => void;
  onAddToCollection: (item: Doc<"libraryItems">) => void;
}

export function LibraryItemRow({
  item,
  onRemove,
  onAddToCollection,
}: LibraryItemRowProps) {
  return (
    <article
      className={cn(
        "group rounded-2xl border p-5 transition-all duration-200",
        "bg-background/95 dark:bg-background/90",
        "border-border/60 dark:border-border/40",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
        "hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-xl hover:shadow-black/[0.05]",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <LibraryRatingStars rating={item.rating} size="md" />
            <LibraryMetadataPills item={item} className="gap-1.5" />
          </div>

          <div className="space-y-2 min-w-0">
            <h2 className="text-base font-semibold leading-snug text-foreground sm:text-lg">
              {item.title}
            </h2>
            {item.authors && (
              <p className="text-sm text-muted-foreground">
                {item.authors}
              </p>
            )}
          </div>

          {item.abstract && (
            <p className="text-sm leading-7 text-muted-foreground line-clamp-4">
              {item.abstract}
            </p>
          )}
        </div>

        <LibraryItemActions
          item={item}
          onRemove={onRemove}
          onAddToCollection={onAddToCollection}
        />
      </div>
    </article>
  );
}
