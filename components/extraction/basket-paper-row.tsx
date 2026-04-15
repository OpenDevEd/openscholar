"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { BasketEntry } from "@/lib/store/extraction-basket";

interface BasketPaperRowProps {
  entry: BasketEntry;
  onRemove: (id: string) => void;
}

export function BasketPaperRow({ entry, onRemove }: BasketPaperRowProps) {
  const t = useTranslations("extraction.basket");

  return (
    <div className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium text-foreground">
          {entry.title}
        </p>
        {entry.doi && (
          <p className="truncate text-xs text-muted-foreground">{entry.doi}</p>
        )}
        <Badge variant="secondary">
          {t(`sourceLabel.${entry.source}`)}
        </Badge>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(entry.openAlexId)}
            aria-label={t("removeAriaLabel", { title: entry.title })}
          >
            <X className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("removeTooltip")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
