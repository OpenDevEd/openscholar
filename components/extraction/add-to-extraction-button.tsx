"use client";

import { useCallback, useMemo } from "react";
import { Plus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import type { BasketSource } from "@/lib/store/extraction-basket";

interface AddToExtractionButtonProps {
  paper: {
    rawId: string;
    title: string;
    doi: string | null;
  };
  source: BasketSource;
}

/**
 * Standalone tooltip-wrapped icon button for adding/removing papers
 * from the extraction basket.
 *
 * 3 visual states:
 * - Default: Plus icon, ghost button
 * - In basket: Check icon, text-primary highlight
 * - Cap disabled: Plus icon, disabled with "Basket full" tooltip
 *
 * Fires a toast when a bulk add is truncated by the cap (D-14, LIM-06).
 */
export function AddToExtractionButton({
  paper,
  source,
}: AddToExtractionButtonProps) {
  const t = useTranslations("extraction.addButton");
  const { addToBasket, removeFromBasket, limit } = useAddToBasket();
  const count = useExtractionBasketStore((s) => s.papers.size);

  const normalizedId = useMemo(
    () => normalizeOpenAlexId(paper.rawId),
    [paper.rawId],
  );

  const inBasket = useExtractionBasketStore((s) =>
    normalizedId ? s.papers.has(normalizedId) : false,
  );

  const isAtCap = count >= limit;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (inBasket) {
        removeFromBasket(paper.rawId);
      } else {
        const result = addToBasket({
          rawId: paper.rawId,
          title: paper.title,
          doi: paper.doi,
          source,
        });
        if (result.dropped > 0) {
          toast.info(
            t("dropped", { added: result.added, dropped: result.dropped }),
          );
        }
      }
    },
    [inBasket, addToBasket, removeFromBasket, paper, source, t],
  );

  const tooltipText = isAtCap && !inBasket
    ? t("basketFull")
    : inBasket
      ? t("inBasket")
      : t("add");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(inBasket && "text-primary")}
          disabled={isAtCap && !inBasket}
          onClick={handleToggle}
          aria-label={inBasket ? t("inBasket") : t("add")}
        >
          {inBasket ? (
            <Check className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
