"use client";

import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

interface EvidenceQuoteProps {
  paperId: Id<"extractionPapers">;
  startChar: number;
  endChar: number;
  className?: string;
}

export function EvidenceQuote({
  paperId,
  startChar,
  endChar,
  className,
}: EvidenceQuoteProps) {
  const t = useTranslations("extraction");
  const { data: paperData } = useProtectedQuery(
    api.extraction.queries.getPaperBodyText,
    { paperId },
  );

  // Empty range -- parent should not render this component
  if (startChar === endChar || startChar === undefined || endChar === undefined) {
    return null;
  }

  // Loading state (undefined = query pending)
  if (paperData === undefined) {
    return (
      <div className={cn("space-y-2 rounded-md p-2", className)}>
        <div className="h-[14px] w-full animate-pulse rounded bg-muted" />
        <div className="h-[14px] w-[85%] animate-pulse rounded bg-muted" />
        <div className="h-[14px] w-[60%] animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Error: paper not found or no access
  if (paperData === null || !paperData.bodyText) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("evidenceUnavailable")}</span>
      </div>
    );
  }

  // Out-of-bounds check
  if (
    startChar < 0 ||
    endChar > paperData.bodyText.length ||
    startChar >= endChar
  ) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("evidenceUnavailable")}</span>
      </div>
    );
  }

  // Render verbatim slice -- NEVER use LLM evidenceQuote
  const verbatimText = paperData.bodyText.slice(startChar, endChar);

  return (
    <div
      role="link"
      tabIndex={0}
      className={cn(
        "cursor-pointer rounded-md border-l-[3px] border-l-primary/40 bg-[var(--pdf-highlight)] px-4 py-2 text-sm leading-[1.43] motion-safe:transition-colors",
        "hover:bg-[color-mix(in_oklch,var(--pdf-highlight)_70%,transparent)]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      aria-label={`View evidence in source at characters ${startChar} to ${endChar}`}
    >
      {verbatimText}
    </div>
  );
}
