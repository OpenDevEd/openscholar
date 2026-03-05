"use client";

import { ExternalLink, MoreHorizontal, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { Doc } from "@/convex/_generated/dataModel";
import { OA_STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type LibraryItem = Doc<"libraryItems">;

export function getDoiUrl(doi: string | undefined): string | null {
  if (!doi) return null;
  return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
}

export function LibraryRatingStars({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "md";
}) {
  const starClassName = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn(
            starClassName,
            value <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/20",
          )}
        />
      ))}
    </div>
  );
}

export function LibraryMetadataPills({
  item,
  compact = false,
  className,
}: {
  item: LibraryItem;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("libraryPage");
  const tc = useTranslations("common");
  const format = useFormatter();

  const pills: Array<{ key: string; label: string; className?: string }> = [];

  pills.push({
    key: "savedAt",
    label: `${t("sortDateSaved")}: ${format.dateTime(new Date(item.savedAt), {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}`,
  });

  if (item.publicationYear) {
    pills.push({
      key: "publicationYear",
      label: `${item.publicationYear}`,
    });
  }

  if (item.journal) {
    pills.push({
      key: "journal",
      label: item.journal,
    });
  }

  if (item.citedByCount !== undefined && item.citedByCount > 0) {
    pills.push({
      key: "citations",
      label: t("citations", { count: item.citedByCount }),
    });
  }

  if (item.oaStatus && item.oaStatus !== "closed" && OA_STATUS_COLORS[item.oaStatus]) {
    pills.push({
      key: "openAccess",
      label: `${tc("openAccess")}: ${item.oaStatus}`,
      className: OA_STATUS_COLORS[item.oaStatus],
    });
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {pills.map((pill) => (
        <span
          key={pill.key}
          className={cn(
            "inline-flex max-w-full items-center rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-muted-foreground",
            compact ? "text-[11px]" : "text-xs",
            pill.className,
          )}
        >
          <span className="truncate">{pill.label}</span>
        </span>
      ))}
    </div>
  );
}

export function LibraryItemActions({
  item,
  onRemove,
  onAddToCollection,
}: {
  item: LibraryItem;
  onRemove: (item: LibraryItem) => void;
  onAddToCollection: (item: LibraryItem) => void;
}) {
  const t = useTranslations("libraryPage");
  const doiUrl = getDoiUrl(item.doi);

  return (
    <div className="flex items-center gap-1">
      {doiUrl && (
        <a
          href={doiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="sr-only">{t("viewFullPaper")}</span>
        </a>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-background/80 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onAddToCollection(item)}>
            {t("addToCollection")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onRemove(item)}
            className="text-destructive focus:text-destructive"
          >
            {t("removeFromLibrary")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
