"use client";

import React, { useContext, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, TranslateIcon } from "@/components/icons";
import { TranslationContext } from "@/components/results-contexts";
import { TranslationSettingsMenu } from "@/components/search-command-center/components/results-translation-control";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import { useBatchTranslation } from "@/hooks/use-batch-translation";
import { useAppToast } from "@/lib/toast";
import type { PaperResult } from "@/lib/types";

interface FocusTranslationControlProps {
  paper: PaperResult;
  listedPapers: PaperResult[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasTranslation: boolean;
  showTranslated: boolean;
  /** The results page is translating this paper already. */
  isTranslating: boolean;
  onToggleTranslation: () => void;
  tFocus: (key: string) => string;
}

/**
 * Focus mode's way to the results page's translation menu, which runs the same way, over the
 * page of the list the paper is on. With no translation yet the button opens the menu; once
 * there is one it switches the text and the arrow opens the menu.
 */
export function FocusTranslationControl({
  paper,
  listedPapers,
  open,
  onOpenChange,
  hasTranslation,
  showTranslated,
  isTranslating,
  onToggleTranslation,
  tFocus,
}: FocusTranslationControlProps) {
  const t = useTranslations("searchCommand");
  const toast = useAppToast();
  const groupRef = useRef<HTMLDivElement>(null);
  const [runId, setRunId] = useState(0);
  const { loadingPaperIds: pageLoading } = useContext(TranslationContext);

  const { loadingPaperIds, isConfigured, translatedPaperCount, totalPaperCount } = useBatchTranslation({
    searchId: "focus-mode",
    papers: listedPapers,
    canStart: true,
    // The page's batch may hold these papers, so it waits to see.
    isSearchLoading: (pageLoading?.size ?? 0) > 0,
    manualRunRequestId: runId,
    onBatchRejected: (error) => toast.ai.failed(t("translate"), error),
  });

  const translating = isTranslating || loadingPaperIds.has(paper.id);
  const listTranslating = loadingPaperIds.size > 0 || (pageLoading?.size ?? 0) > 0;
  const variant = showTranslated ? "outline-primary" : "outline";
  const label = !hasTranslation ? t("translate") : showTranslated ? tFocus("original") : tFocus("translation");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <ButtonGroup ref={groupRef}>
          <Button
            variant={variant}
            size="sm"
            // Short of the full header's width it is its icon alone, so Close stays on screen.
            className="max-xl:w-8 max-xl:px-0"
            onClick={hasTranslation ? onToggleTranslation : () => onOpenChange(!open)}
            aria-label={!hasTranslation ? t("translate") : showTranslated ? tFocus("showOriginal") : tFocus("showTranslation")}
            disabled={translating && !hasTranslation}
          >
            <TranslateIcon working={translating} size={12} className="h-3 w-3 xl:mr-1" />
            <span className="hidden xl:inline">{label}</span>
          </Button>
          <PopoverTrigger asChild>
            <Button variant={variant} size="icon-sm" className="w-6" aria-label={t("translationSettings")}>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
        </ButtonGroup>
      </PopoverAnchor>
      <TranslationSettingsMenu
        isConfigured={isConfigured}
        isTranslating={listTranslating}
        allTranslated={!listTranslating && totalPaperCount > 0 && translatedPaperCount === totalPaperCount}
        onRun={() => setRunId((id) => id + 1)}
        // The button beside the arrow toggles the menu itself.
        onInteractOutside={(event) => {
          if (groupRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      />
    </Popover>
  );
}
