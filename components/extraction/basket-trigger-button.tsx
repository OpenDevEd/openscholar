"use client";

import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";

export function BasketTriggerButton() {
  const t = useTranslations("extraction.basket");
  const count = useExtractionBasketStore((s) => s.papers.size);
  const hasHydrated = useExtractionBasketStore((s) => s._hasHydrated);
  const setDrawerOpen = useExtractionBasketStore((s) => s.setDrawerOpen);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("triggerAriaLabel", { count })}
          >
            <FlaskConical className="size-4" />
          </Button>
          {hasHydrated && count > 0 && (
            <Badge
              variant="default"
              className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center p-0 text-[10px]"
            >
              {count > 9 ? "9+" : count}
            </Badge>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{t("triggerTooltip")}</TooltipContent>
    </Tooltip>
  );
}
