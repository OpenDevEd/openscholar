"use client";

import { ExternalLink, FileText, RotateCcw } from "@/components/icons";

import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Button } from "@/components/ui/button";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import {
  classifyCitationState,
  type CitationState,
} from "@/lib/chat/citation-state";
import { applyInclusionPatchToSnapshot } from "@/lib/chat/chat-papers-selection";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import { cn } from "@/lib/utils";
import {
  DeprecatedPaperCitationsProvider,
  useDeprecatedPaperCitations,
} from "./paper-citation-context";
import { usePapersContext } from "./papers-context";

export { DeprecatedPaperCitationsProvider };

export type PaperCitationTarget = ResolvablePaper;

interface PaperCitationProps {
  index: number;
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
    "border border-dashed border-muted-foreground/40 bg-inset text-muted-foreground",
    "hover:bg-muted hover:text-foreground",
  ),
  unresolved: cn(
    BASE_PILL,
    "bg-muted text-muted-foreground/80",
  ),
  deprecated: cn(
    BASE_PILL,
    "border border-warning/35 bg-warning/10 ink-warning",
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

export function PaperCitation({ index }: PaperCitationProps) {
  const t = useTranslations("extraction");
  const tCommon = useTranslations("common");
  const tAcc = useTranslations("accessibility");
  const { papersByPosition, jobId } = usePapersContext();
  const deprecated = useDeprecatedPaperCitations();
  const paper = papersByPosition.get(index) ?? null;

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
      applyInclusionPatchToSnapshot(
        current,
        new Map([[args.chatPaperId, args.included]]),
      ),
    );
  });

  const state = classifyCitationState(paper, { deprecated });

  if (state === "deprecated") {
    return (
      <InlineCitationCard openDelay={120} closeDelay={160}>
        <HoverCardTrigger asChild>
          <span
            className={PILL_CLASS_BY_STATE.deprecated}
            data-citation-state="deprecated"
            data-paper-index={index}
            data-paper-resolved="deprecated"
            aria-label={t("chatCitationDeprecated", { index })}
            tabIndex={0}
          >
            {index}
          </span>
        </HoverCardTrigger>
        <InlineCitationCardBody>
          <div className="space-y-2 p-3">
            <InlineCitationSource
              title={t("chatCitationDeprecatedTitle", { index })}
              description={t("chatCitationDeprecatedDescription")}
            />
          </div>
        </InlineCitationCardBody>
      </InlineCitationCard>
    );
  }

  if (state === "unresolved") {
    return (
      <TooltipHint label={t("chatCitationUnresolved", { index })}>
        <span
          className={PILL_CLASS_BY_STATE.unresolved}
          data-citation-state="unresolved"
          data-paper-index={index}
          data-paper-resolved="false"
          aria-label={t("chatCitationUnresolved", { index })}
        >
          {index}?
        </span>
      </TooltipHint>
    );
  }

  // Non-null by classifyCitationState contract.
  const p = paper!;
  const authorsStr =
    p.authors.length > 0 ? p.authors.join(", ") : t("unknownAuthors");
  const yearStr = p.year != null ? String(p.year) : "—";
  const description = `${authorsStr}, ${yearStr}`;
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
                    "h-7 px-2 ink-success border-success/30 hover:bg-success/10 hover:border-success/40",
                  )}
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
                    "h-7 px-2 ink-info border-info/30 hover:bg-info/10 hover:border-info/40",
                  )}
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
                    "h-7 px-2 ink-warning border-warning/30 hover:bg-warning/10 hover:border-warning/40",
                  )}
                >
                  <a
                    href={openalexUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-paper-card-link="openalex"
                  >
                    <OpenAlexIcon className="h-3.5 w-3.5" />
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
