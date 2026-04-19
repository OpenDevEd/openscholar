"use client";

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import { HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";

/**
 * Resolved paper shape the citation renderer consumes. Narrowed from the
 * `extractionJobSources` row to only the fields the citation card
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

  const authorsStr = paper.authors.length > 0
    ? paper.authors.join(", ")
    : t("unknownAuthors");
  const yearStr = paper.year != null ? String(paper.year) : "—";
  const description = `${authorsStr} · ${yearStr}`;
  const url = paper.doi
    ? `https://doi.org/${paper.doi}`
    : paper.openalexId
      ? `https://openalex.org/${paper.openalexId}`
      : undefined;

  return (
    <InlineCitationCard>
      <HoverCardTrigger asChild>
        <Badge
          variant="secondary"
          className="ml-0.5 cursor-pointer rounded-full"
          data-paper-id={paper._id ?? ""}
          data-paper-index={index}
          data-paper-resolved="true"
        >
          [P{index}]
        </Badge>
      </HoverCardTrigger>
      <InlineCitationCardBody>
        <div className="p-3">
          <InlineCitationSource
            title={paper.title}
            description={description}
            url={url}
          />
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}
