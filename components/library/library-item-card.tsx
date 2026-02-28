"use client";

import { useTranslations } from "next-intl";
import { Star, MoreHorizontal, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";

interface LibraryItemCardProps {
  item: Doc<"libraryItems">;
  onRemove: (item: Doc<"libraryItems">) => void;
}

const OA_COLORS: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  bronze: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  hybrid: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

export function LibraryItemCard({ item, onRemove }: LibraryItemCardProps) {
  const t = useTranslations("libraryPage");

  const doiUrl = item.doi
    ? item.doi.startsWith("http")
      ? item.doi
      : `https://doi.org/${item.doi}`
    : null;

  return (
    <div className="rounded-lg border border-border/50 bg-background/80 p-4 flex flex-col gap-2 hover:bg-muted/30 transition-colors relative">
      {/* Header: Rating stars + actions */}
      <div className="flex items-center justify-between">
        {/* Rating stars */}
        <div className="flex items-center gap-px">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              className={cn(
                "h-3 w-3",
                s <= item.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/25",
              )}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {doiUrl && (
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">{t("viewFullPaper")}</span>
            </a>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => onRemove(item)}
                className="text-destructive focus:text-destructive"
              >
                {t("removeFromLibrary")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium line-clamp-2 leading-snug">
        {item.title}
      </h3>

      {/* Authors */}
      {item.authors && (
        <p className="text-xs text-muted-foreground line-clamp-1">
          {item.authors}
        </p>
      )}

      {/* Footer: Year | Journal | OA badge | Citations */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mt-auto">
        {item.publicationYear && (
          <span className="tabular-nums">{item.publicationYear}</span>
        )}
        {item.journal && (
          <>
            <span className="text-border">|</span>
            <span className="truncate max-w-[120px]">{item.journal}</span>
          </>
        )}
        {item.oaStatus && item.oaStatus !== "closed" && OA_COLORS[item.oaStatus] && (
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
              OA_COLORS[item.oaStatus],
            )}
          >
            {item.oaStatus}
          </span>
        )}
        {item.citedByCount !== undefined && item.citedByCount > 0 && (
          <span className="tabular-nums">
            {t("citations", { count: item.citedByCount })}
          </span>
        )}
      </div>

      {/* Abstract preview */}
      {item.abstract && (
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
          {item.abstract}
        </p>
      )}
    </div>
  );
}
