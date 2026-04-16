"use client";

import { useTranslations } from "next-intl";
import { Loader2, Check, X, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ResolutionState = "idle" | "resolving" | "resolved" | "failed";

export interface ZoteroItemForUI {
  key: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
  itemType: string;
  numChildren?: number;
  hasPdfChild: boolean;
}

interface ZoteroItemRowProps {
  item: ZoteroItemForUI;
  resolutionState: ResolutionState;
  onResolve: (itemKey: string, doi: string) => void;
  onRetry: (itemKey: string, doi: string) => void;
  isInBasket: boolean;
}

export function ZoteroItemRow({
  item,
  resolutionState,
  onResolve,
  onRetry,
  isInBasket,
}: ZoteroItemRowProps) {
  const t = useTranslations("extraction.zoteroTab");

  function renderCheckboxArea() {
    if (!item.doi) {
      // STATE 5: No DOI — disabled checkbox with tooltip (ZOT-04, D-08)
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                disabled
                aria-disabled="true"
                aria-label={t("noDoi")}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{t("noDoi")}</TooltipContent>
        </Tooltip>
      );
    }

    if (isInBasket) {
      // STATE 3: Resolved + in basket — green checkmark
      return (
        <Check
          className="h-4 w-4 text-green-600 dark:text-green-400"
          aria-label={t("resolved")}
        />
      );
    }

    if (resolutionState === "resolving") {
      // STATE 2: Resolving — inline spinner replacing checkbox
      return (
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground"
          aria-label={t("resolving")}
        />
      );
    }

    if (resolutionState === "failed") {
      // STATE 4: Failed — red X with retry button and tooltip
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onRetry(item.key, item.doi!)}
              className="rounded p-1 -m-1 focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={t("retryResolve")}
            >
              <X className="h-4 w-4 text-destructive cursor-pointer" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("resolveFailed")}</TooltipContent>
        </Tooltip>
      );
    }

    // STATE 1: Idle — unchecked checkbox ready to resolve
    return (
      <Checkbox
        checked={false}
        onCheckedChange={() => onResolve(item.key, item.doi!)}
        aria-label={`Add ${item.title} to extraction`}
      />
    );
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex items-center gap-3 py-3",
          (isInBasket || !item.doi) && "opacity-60",
        )}
      >
        {/* Checkbox / indicator column — 24px fixed width (UI spec) */}
        <div className="flex-shrink-0 w-6 flex items-center justify-center min-h-[44px] min-w-[44px]">
          {renderCheckboxArea()}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{item.title}</p>
          {item.authors.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              {item.authors.join(", ")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {item.year && (
              <span className="text-xs text-muted-foreground">{item.year}</span>
            )}
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {item.itemType}
            </Badge>
            {item.doi && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-mono"
              >
                {item.doi.length > 30
                  ? `${item.doi.slice(0, 30)}\u2026`
                  : item.doi}
              </Badge>
            )}
            {item.hasPdfChild && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                <FileText className="w-2.5 h-2.5 mr-0.5" />
                {t("hasPdf")}
              </Badge>
            )}
            {isInBasket && (
              <span className="text-xs text-muted-foreground ml-auto">
                {t("alreadyInBasket")}
              </span>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
