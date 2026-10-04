"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BookOpen, CircleAlert } from "@/components/icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { rejectedQuery } from "@/lib/search/search-error";
import { OQL_REFERENCE_URL } from "@/lib/openalex/oql";

/**
 * The line under an OQL query: what OpenAlex rejected, or a link to the OQL
 * reference. One fixed-height line, so an error never moves the results. The
 * results area explains the error in full.
 */
export function OqlQueryStatus({ error }: { error: Error | null }) {
  const t = useTranslations("searchCommand");
  const reason = rejectedQuery(error)?.problem ?? null;

  return (
    <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5 px-1 text-xs">
      {reason ? (
        <>
          <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
          <TooltipHint label={reason} onlyWhenClipped>
            <span role="alert" tabIndex={0} className="truncate text-destructive outline-none">
              {reason}
            </span>
          </TooltipHint>
        </>
      ) : (
        <a
          href={OQL_REFERENCE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <BookOpen className="size-3.5" aria-hidden />
          {t("oqlReference")}
        </a>
      )}
    </div>
  );
}
