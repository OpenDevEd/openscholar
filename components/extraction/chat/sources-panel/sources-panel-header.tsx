"use client";

import { useTranslations } from "next-intl";
import { FileTextIcon } from "lucide-react";

interface SourcesPanelHeaderProps {
  totalCount: number;
  includedCount: number;
}

export function SourcesPanelHeader({
  totalCount,
  includedCount,
}: SourcesPanelHeaderProps) {
  const t = useTranslations("sourcesPanel");
  return (
    <header
      className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3"
      data-sources-panel-header
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate text-sm font-semibold text-foreground">
          {t("title")}
        </h2>
      </div>
      <span
        role="status"
        aria-live="polite"
        data-sources-count={includedCount}
        data-sources-total={totalCount}
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {t("countLive", { included: includedCount, total: totalCount })}
      </span>
    </header>
  );
}
