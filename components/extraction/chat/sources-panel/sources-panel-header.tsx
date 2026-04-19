"use client";

import { useTranslations } from "next-intl";

interface SourcesPanelHeaderProps {
  totalCount: number;
  includedCount: number;
}

export function SourcesPanelHeader({
  totalCount,
  includedCount,
}: SourcesPanelHeaderProps) {
  const t = useTranslations("sourcesPanel");
  const progress =
    totalCount > 0 ? Math.round((includedCount / totalCount) * 100) : 0;

  return (
    <header
      className="flex flex-col gap-1.5 border-b border-border/50 px-3 pb-2.5 pt-3"
      data-sources-panel-header
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <span
          role="status"
          aria-live="polite"
          aria-label={t("progressLabel", {
            included: includedCount,
            total: totalCount,
          })}
          data-sources-count={includedCount}
          data-sources-total={totalCount}
          className="text-xs tabular-nums text-muted-foreground"
        >
          <span className="text-sm font-semibold text-foreground">
            {includedCount}
          </span>
          <span className="mx-0.5 text-muted-foreground/70">/</span>
          <span>{totalCount}</span>
        </span>
      </div>
      <div
        role="presentation"
        aria-hidden="true"
        data-sources-progress={progress}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  );
}
