"use client";

import { ArrowUpRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { Badge } from "@/components/ui/badge";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";

/**
 * Resolved paper shape the citation renderer consumes. Narrowed from
 * the `extractionJobSources` row to only the fields the citation card
 * displays — the sidebar resolver passes a superset and it's fine.
 */
export interface PaperCitationTarget extends ResolvablePaper {
  _id?: string;
  openalexId?: string;
  doi?: string;
}

interface PaperCitationProps {
  index: number;
  paper: PaperCitationTarget | null;
}

/**
 * Build the external URL for a paper. DOI takes precedence because
 * DOIs resolve to the publisher landing page (full text when OA);
 * OpenAlex is the always-available fallback. `openalexId` is stored
 * as the short form `W123…` (see `lib/openalex/work-mapper.ts`).
 */
function resolvePaperUrl(paper: PaperCitationTarget): string | undefined {
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  if (paper.openalexId) return `https://openalex.org/${paper.openalexId}`;
  return undefined;
}

export function PaperCitation({ index, paper }: PaperCitationProps) {
  const t = useTranslations("extraction");

  if (!paper) {
    return (
      <span
        className="text-muted-foreground"
        data-paper-index={index}
        data-paper-resolved="false"
      >
        [P{index}?]
      </span>
    );
  }

  const authorsStr =
    paper.authors.length > 0 ? paper.authors.join(", ") : t("unknownAuthors");
  const yearStr = paper.year != null ? String(paper.year) : "—";
  const description = `${authorsStr} · ${yearStr}`;
  const url = resolvePaperUrl(paper);
  const ariaLabel = `${t("chatCitationOpen", { title: paper.title })}`;

  const sharedData = {
    "data-paper-id": paper._id ?? "",
    "data-paper-index": index,
    "data-paper-resolved": "true",
    "data-paper-url": url ?? "",
  } as const;

  // openDelay/closeDelay override the upstream HoverCard defaults
  // (both 0). Real-world use showed the 0/0 config flickers and makes
  // it impossible to move the pointer into the card content.
  return (
    <InlineCitationCard openDelay={120} closeDelay={160}>
      <HoverCardTrigger asChild>
        {url ? (
          <Badge
            asChild
            variant="secondary"
            className="ml-0.5 rounded-full font-medium no-underline hover:bg-secondary/80"
          >
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={ariaLabel}
              {...sharedData}
            >
              [P{index}]
            </a>
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="ml-0.5 rounded-full font-medium"
            aria-label={`${t("chatCitationPreview", { title: paper.title })}`}
            tabIndex={0}
            {...sharedData}
          >
            [P{index}]
          </Badge>
        )}
      </HoverCardTrigger>
      <InlineCitationCardBody>
        <div className="space-y-2 p-3">
          <InlineCitationSource title={paper.title} description={description} />
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
              data-paper-card-link="true"
            >
              {paper.doi ? t("chatCitationOpenDoi") : t("chatCitationOpenOpenAlex")}
              <ArrowUpRightIcon aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}
