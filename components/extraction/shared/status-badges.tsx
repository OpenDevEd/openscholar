"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import { isReviewed } from "@/lib/extraction/reviews";
import { useTranslations } from "next-intl";

const statusVariants = {
  error: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  success: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  accent: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  neutral: "text-muted-foreground border-border",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
} as const;

type StatusVariant = keyof typeof statusVariants;

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("h-4 px-1 text-2xs", statusVariants[variant], className)}
    >
      {children}
    </Badge>
  );
}

interface PaperStatusBadgesProps {
  paper: Doc<"extractionPapers"> & { results: Doc<"extractionResults">[] };
  showAbstract?: boolean;
}

export function PaperStatusBadges({ paper, showAbstract = true }: PaperStatusBadgesProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const hasAbstract =
    !!paper.abstract && paper.abstract.length > MIN_ABSTRACT_LENGTH;
  const hasPdfSource =
    !!paper.pdfUrl || !!paper.storageId || !!paper.ragEntryId || !!paper.isIndexed;
  const showAbstractBadge =
    showAbstract &&
    hasAbstract &&
    !paper.pdfContentUsed &&
    !paper.isIndexed &&
    !paper.ragEntryId &&
    paper.status !== "download_failed";
  const abstractLabel =
    !paper.isOpenAccess && !hasPdfSource ? tc("abstractOnly") : tc("abstract");
  const showNoContent =
    paper.status === "download_failed" && !hasAbstract;
  const reviewedCount = paper.results.filter((result) => isReviewed(result)).length;

  return (
    <>
      {showNoContent ? (
        <StatusBadge variant="error">{tc("noContent")}</StatusBadge>
      ) : null}
      {paper.isOpenAccess && (
        <StatusBadge variant="success">{tc("openAccess")}</StatusBadge>
      )}
      {paper.isIndexed || paper.ragEntryId ? (
        <StatusBadge variant="accent">{tc("indexed")}</StatusBadge>
      ) : null}
      {paper.pdfContentUsed ? (
        <StatusBadge variant="info">{tc("pdfUsed")}</StatusBadge>
      ) : null}
      {showAbstractBadge ? (
        <StatusBadge variant="neutral">{abstractLabel}</StatusBadge>
      ) : null}
      {reviewedCount > 0 ? (
        <StatusBadge variant="warning">
          {t("reviewed", { count: reviewedCount, total: paper.results.length })}
        </StatusBadge>
      ) : null}
    </>
  );
}
