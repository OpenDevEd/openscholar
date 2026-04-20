"use client";

/**
 * Plan-07 — expandable per-paper error history.
 *
 * Lists every row from `extractionPaperErrors.by_paper` in reverse
 * chronological order so the user can see the full retry trail for a
 * failed question. Radix Accordion provides the collapse/expand
 * affordance + ARIA `aria-expanded` / `aria-controls` plumbing for
 * free; the trigger button is keyboard-reachable and the content
 * region uses Radix's built-in role="region".
 *
 * Contract — per project testing doctrine (assert on attributes, not
 * Tailwind strings):
 *   data-error-history        — on the wrapper; carries the paperId
 *   data-error-code            — on each row; keys the taxonomy
 *                                translation and drives test assertions
 *   data-attempt-number        — on each row; the 1-indexed attempt #
 *
 * Pagination: initial page is 10 rows (UI cap per plan). "Show more"
 * loads the next 10; `status === "CanLoadMore"` gates the CTA.
 */

import { AlertCircle, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

export interface ErrorHistoryProps {
  paperId: Id<"extractionPapers">;
  /** Initial page size (also re-used as the "Show more" increment). */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10;

function formatTimestamp(at: number): string {
  // Short, locale-neutral timestamp. Caller locale handled via Intl in the
  // browser runtime; jsdom lands on "en-US" which keeps tests stable.
  return new Date(at).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export function ErrorHistory({
  paperId,
  pageSize = DEFAULT_PAGE_SIZE,
}: ErrorHistoryProps) {
  const t = useTranslations("extraction.errorHistory");
  const tTitle = useTranslations("errors.title");

  const query = useProtectedPaginatedQuery(
    api.extraction.queries.errorHistory.listPaperErrors,
    { paperId },
    { initialNumItems: pageSize },
  );
  const { results, status, loadMore, isInitialLoading, isSettled } = query;
  const canLoadMore = status === "CanLoadMore";

  // Empty / not-yet-ready: render nothing. A closed accordion with no
  // items is noise; the paper row's status dot already conveys success.
  if (!isSettled || (isInitialLoading && results.length === 0)) return null;
  if (results.length === 0) return null;

  return (
    <Accordion type="single" collapsible>
      <AccordionItem
        value="error-history"
        data-error-history
        data-paper-id={paperId}
      >
        <AccordionTrigger
          aria-label={t("triggerLabel", { count: results.length })}
        >
          <span className="inline-flex items-center gap-2 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {t("trigger", { count: results.length })}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <ul className="space-y-2">
            {results.map((row) => {
              const code = row.code;
              const titleFromTaxonomy = tTitle(code);
              return (
                <li
                  key={row._id}
                  data-error-code={code}
                  data-attempt-number={row.attempt}
                  className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-destructive">
                      {t("attempt", { n: row.attempt })}
                    </span>
                    <time
                      dateTime={new Date(row.at).toISOString()}
                      className="text-muted-foreground tabular-nums"
                    >
                      {formatTimestamp(row.at)}
                    </time>
                  </div>
                  <p className="mt-1 font-medium">{titleFromTaxonomy}</p>
                  <p className="mt-0.5 text-muted-foreground">{row.message}</p>
                </li>
              );
            })}
          </ul>
          {canLoadMore ? (
            <div className="pt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadMore(pageSize)}
                data-action="load-more"
              >
                <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
