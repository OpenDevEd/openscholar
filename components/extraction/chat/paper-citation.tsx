"use client";

import { ExternalLink, FileText, Library, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Button } from "@/components/ui/button";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  classifyCitationState,
  type CitationState,
} from "@/lib/chat/citation-state";
import { applyInclusionPatch } from "@/lib/chat/chat-papers-selection";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import { cn } from "@/lib/utils";

export type PaperCitationTarget = ResolvablePaper;

interface PaperCitationProps {
  index: number;
  paper: ResolvablePaper | null;
  jobId: Id<"extractionJobs">;
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
 * Pill chrome keyed on `data-citation-state`. Included is the primary-
 * tinted chip that users see most of the time; excluded is muted with a
 * dashed border — still clickable so the link and metadata still work,
 * just visually honest that the LLM won't see this paper on the next
 * turn; unresolved is the grey `[N?]` chip for rare data-integrity
 * cases (paper gone from the live list altogether).
 */
const BASE_PILL = cn(
  "mx-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center",
  "rounded-full px-1 text-[0.72em] font-semibold leading-none",
  "align-baseline no-underline",
  "transition-[background-color,border-color,color] duration-[180ms] ease-out motion-reduce:transition-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
);

const PILL_CLASS_BY_STATE: Record<CitationState, string> = {
  included: cn(
    BASE_PILL,
    "bg-primary/10 text-primary hover:bg-primary/20",
  ),
  excluded: cn(
    BASE_PILL,
    "border border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground",
    "hover:bg-muted/60 hover:text-foreground",
  ),
  unresolved: cn(
    BASE_PILL,
    "bg-muted text-muted-foreground/80",
  ),
};

/**
 * Resolve every external link the citation card may surface. OpenAlex
 * is always shown when we have an openalexId (the user asked for it
 * as the guaranteed baseline). DOI and PDF are additive — shown when
 * present, hidden when not, matching the paper-card button pattern.
 */
function resolvePaperLinks(paper: ResolvablePaper): PaperLinks {
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

export function PaperCitation({ index, paper, jobId }: PaperCitationProps) {
  const t = useTranslations("extraction");
  const tCommon = useTranslations("common");
  const tAcc = useTranslations("accessibility");

  const reinclude = useMutation(
    api.chat.chatPapers.toggleChatPaper,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(
        current,
        new Map([[args.chatPaperId, args.included]]),
      ),
    );
  });

  const state = classifyCitationState(paper);

  if (state === "unresolved") {
    return (
      <span
        className={PILL_CLASS_BY_STATE.unresolved}
        data-citation-state="unresolved"
        data-paper-index={index}
        data-paper-resolved="false"
        aria-label={t("chatCitationUnresolved", { index })}
        title={`${index}?`}
      >
        {index}?
      </span>
    );
  }

  // Non-null by classifyCitationState contract.
  const p = paper!;
  const authorsStr =
    p.authors.length > 0 ? p.authors.join(", ") : t("unknownAuthors");
  const yearStr = p.year != null ? String(p.year) : "—";
  const description = `${authorsStr} · ${yearStr}`;
  const { openalexUrl, doiUrl, pdfUrl, shortDoi, primary } =
    resolvePaperLinks(p);
  const ariaLabel =
    state === "excluded"
      ? t("chatCitationExcluded", { title: p.title })
      : t("chatCitationOpen", { title: p.title });

  const sharedData = {
    "data-citation-state": state,
    "data-paper-id": p.sourceId,
    "data-paper-index": index,
    "data-paper-resolved": "true",
    "data-paper-url": primary ?? "",
  } as const;

  const pillClass = PILL_CLASS_BY_STATE[state];

  const handleReinclude = () => {
    void reinclude({ chatPaperId: p.chatPaperId, included: true });
  };

  return (
    <InlineCitationCard openDelay={120} closeDelay={160}>
      <HoverCardTrigger asChild>
        {primary ? (
          <a
            href={primary}
            target="_blank"
            rel="noreferrer"
            aria-label={ariaLabel}
            className={pillClass}
            {...sharedData}
          >
            {index}
          </a>
        ) : (
          <span
            className={pillClass}
            aria-label={
              state === "excluded"
                ? t("chatCitationExcluded", { title: p.title })
                : t("chatCitationPreview", { title: p.title })
            }
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
          <InlineCitationSource title={p.title} description={description} />
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
          {state === "excluded" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full px-2"
              data-reinclude-action
              onClick={handleReinclude}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="text-xs">
                {t("chatCitationReincludeForFutureTurns")}
              </span>
            </Button>
          ) : null}
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}
