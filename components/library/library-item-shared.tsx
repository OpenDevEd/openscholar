"use client";

import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddToExtractionButton } from "@/components/extraction/add-to-extraction-button";

type LibraryItem = Doc<"libraryItems">;

function getDoiUrl(doi: string | undefined): string | null {
  if (!doi) return null;
  return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
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
    <div className="flex items-center gap-1 rounded-lg bg-background/90 shadow-sm backdrop-blur-sm">
      <AddToExtractionButton
        paper={{
          rawId: item.openalexId,
          title: item.title,
          doi: item.doi ?? null,
        }}
        source="library"
      />
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
