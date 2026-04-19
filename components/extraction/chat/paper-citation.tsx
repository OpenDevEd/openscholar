"use client";

import { ExternalLink, FileText, Library } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Button } from "@/components/ui/button";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import { cn } from "@/lib/utils";

/**
 * Inline citation pill — tiny, primary-tinted chip carrying just
 * the paper number. Sized so it sits on the baseline without
 * disrupting prose line-height. Adjacent pills in combined-bracket
 * form nestle together via the space-x rhythm in the parent.
 */
const PILL_CLASS = cn(
  "mx-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center",
  "rounded-full px-1 text-[0.72em] font-semibold leading-none",
  "bg-primary/10 text-primary align-baseline",
  "transition-colors no-underline",
  "hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
);

const PILL_UNRESOLVED_CLASS = cn(
  "mx-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center",
  "rounded-full px-1 text-[0.72em] font-semibold leading-none",
  "bg-muted text-muted-foreground/80 align-baseline",
);

/**
 * Resolved paper shape the citation renderer consumes. Narrowed from
 * the `extractionJobSources` row to only the fields the citation card
 * displays — the sidebar resolver passes a superset and it's fine.
 */
export interface PaperCitationTarget extends ResolvablePaper {
  _id?: string;
  openalexId?: string;
  doi?: string;
  pdfUrl?: string;
}

interface PaperCitationProps {
  index: number;
  paper: PaperCitationTarget | null;
}

interface PaperLinks {
  openalexUrl: string | undefined;
  doiUrl: string | undefined;
  pdfUrl: string | undefined;
  shortDoi: string | undefined;
  /** Best single destination for a click on the pill itself. */
  primary: string | undefined;
}

/**
 * Resolve every external link the citation card may surface. OpenAlex
 * is always shown when we have an openalexId (the user asked for it
 * as the guaranteed baseline). DOI and PDF are additive — shown when
 * present, hidden when not, matching the paper-card button pattern.
 */
function resolvePaperLinks(paper: PaperCitationTarget): PaperLinks {
  const openalexUrl = paper.openalexId
    ? `https://openalex.org/${paper.openalexId}`
    : undefined;

  const rawDoi = paper.doi?.trim();
  const doiUrl = rawDoi
    ? rawDoi.startsWith("http")
      ? rawDoi
      : `https://doi.org/${rawDoi}`
    : undefined;
  const shortDoi = rawDoi
    ? rawDoi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    : undefined;

  const pdfUrl = paper.pdfUrl?.trim() || undefined;

  // Pill destination: OpenAlex first (baseline), DOI, then PDF.
  const primary = openalexUrl ?? doiUrl ?? pdfUrl;

  return { openalexUrl, doiUrl, pdfUrl, shortDoi, primary };
}

export function PaperCitation({ index, paper }: PaperCitationProps) {
  const t = useTranslations("extraction");
  const tCommon = useTranslations("common");
  const tAcc = useTranslations("accessibility");

  if (!paper) {
    return (
      <span
        className={PILL_UNRESOLVED_CLASS}
        data-paper-index={index}
        data-paper-resolved="false"
        title={`${index}?`}
      >
        {index}?
      </span>
    );
  }

  const authorsStr =
    paper.authors.length > 0 ? paper.authors.join(", ") : t("unknownAuthors");
  const yearStr = paper.year != null ? String(paper.year) : "—";
  const description = `${authorsStr} · ${yearStr}`;
  const { openalexUrl, doiUrl, pdfUrl, shortDoi, primary } =
    resolvePaperLinks(paper);
  const ariaLabel = t("chatCitationOpen", { title: paper.title });

  const sharedData = {
    "data-paper-id": paper._id ?? "",
    "data-paper-index": index,
    "data-paper-resolved": "true",
    "data-paper-url": primary ?? "",
  } as const;

  return (
    <InlineCitationCard openDelay={120} closeDelay={160}>
      <HoverCardTrigger asChild>
        {primary ? (
          <a
            href={primary}
            target="_blank"
            rel="noreferrer"
            aria-label={ariaLabel}
            className={PILL_CLASS}
            {...sharedData}
          >
            {index}
          </a>
        ) : (
          <span
            className={PILL_CLASS}
            aria-label={t("chatCitationPreview", { title: paper.title })}
            role="button"
            tabIndex={0}
            {...sharedData}
          >
            {index}
          </span>
        )}
      </HoverCardTrigger>
      <InlineCitationCardBody>
        <div className="space-y-3 p-3">
          <InlineCitationSource title={paper.title} description={description} />
          {(openalexUrl || doiUrl || pdfUrl) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pdfUrl ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50",
                  )}
                  title={tCommon("openAccessPdf")}
                >
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-paper-card-link="pdf"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span className="text-xs">{tCommon("pdf")}</span>
                  </a>
                </Button>
              ) : null}
              {doiUrl ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/50",
                  )}
                  title={tAcc("openDoi")}
                >
                  <a
                    href={doiUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-paper-card-link="doi"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="text-xs font-mono max-w-[12rem] truncate">
                      {shortDoi}
                    </span>
                  </a>
                </Button>
              ) : null}
              {openalexUrl ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-amber-700 border-amber-200 hover:bg-amber-50 hover:border-amber-300 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/50",
                  )}
                  title={t("chatCitationOpenOpenAlex")}
                >
                  <a
                    href={openalexUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-paper-card-link="openalex"
                  >
                    <Library className="h-3.5 w-3.5" />
                    <span className="text-xs">OpenAlex</span>
                  </a>
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}
