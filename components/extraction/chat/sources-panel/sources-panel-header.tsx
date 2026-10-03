"use client";

import { useTranslations } from "next-intl";
import { useIsMobile } from "@/lib/hooks";

interface SourcesPanelHeaderProps {
  totalCount: number;
  includedCount: number;
}

export function SourcesPanelHeader({
  totalCount,
  includedCount,
}: SourcesPanelHeaderProps) {
  const t = useTranslations("sourcesPanel");
  // On mobile the panel is hosted inside a Sheet that pins its own
  // close X at top-4 right-4. Right-aligning the count badge there
  // overlaps the X. Render count BEFORE title on mobile and reserve
  // right-padding so the X has its own lane.
  const isMobile = useIsMobile();
  const progress =
    totalCount > 0 ? Math.round((includedCount / totalCount) * 100) : 0;

  const title = (
    <h2 className="text-base font-semibold tracking-tight text-foreground">
      {t("title")}
    </h2>
  );

  const countBadge = (
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
  );

  return (
    <header
      className={
        isMobile
          ? "flex flex-col gap-1.5 border-b border-border-subtle px-3 pb-2.5 pt-3 pr-10"
          : "flex flex-col gap-1.5 border-b border-border-subtle px-3 pb-2.5 pt-3"
      }
      data-sources-panel-header
      data-mobile={isMobile ? "true" : "false"}
    >
      <div
        className={
          isMobile
            ? "flex items-baseline gap-3"
            : "flex items-baseline justify-between gap-2"
        }
      >
        {isMobile ? (
          <>
            {countBadge}
            {title}
          </>
        ) : (
          <>
            {title}
            {countBadge}
          </>
        )}
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
