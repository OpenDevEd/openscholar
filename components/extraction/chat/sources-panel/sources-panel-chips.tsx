"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChipCounts, SourceChip } from "@/lib/chat/source-chips";

const VISIBLE_CHIPS: ReadonlyArray<SourceChip> = [
  "all",
  "openalex",
  "upload",
  "zotero",
  "history",
];

interface SourcesPanelChipsProps {
  counts: ChipCounts;
  selected: SourceChip;
  onSelect: (next: SourceChip) => void;
}

export function SourcesPanelChips({
  counts,
  selected,
  onSelect,
}: SourcesPanelChipsProps) {
  const t = useTranslations("sourcesPanel.chips");
  return (
    <div
      role="group"
      aria-label={t("groupLabel")}
      className="flex flex-wrap gap-1 border-b border-border/50 px-4 py-2"
      data-sources-panel-chips
    >
      {VISIBLE_CHIPS.map((chip) => {
        const count = counts[chip];
        const disabled = chip !== "all" && count === 0;
        const active = chip === selected;
        return (
          <Button
            key={chip}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-7 px-2 text-[11px]")}
            data-source-chip-button={chip}
            data-active={active ? "true" : undefined}
            data-chip-count={count}
            aria-pressed={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => onSelect(chip)}
          >
            {t(chip)} ({count})
          </Button>
        );
      })}
    </div>
  );
}
