"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, Maximize2, Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import { getAllCitationLocations, getCitationStatus } from "@/lib/extraction/citations";
import type { ExtractionResultRecord, PaperWithResults } from "@/lib/extraction/filtering";
import { cn } from "@/lib/utils";
import { HighlightedText } from "./highlighted-text";

// The pieces every results view shares, so a table cell, a card and the split
// view say the same thing the same way.

const CONFIDENCE_TEXT: Record<StatusTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
  running: "text-primary",
};

function confidenceTone(value?: number): StatusTone {
  if (!value) return "neutral";
  return value >= 0.8 ? "success" : value >= 0.5 ? "warning" : "danger";
}

/** A confidence between 0 and 1, as a coloured percentage. */
export function ConfidenceValue({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("text-xs font-medium tabular-nums", CONFIDENCE_TEXT[confidenceTone(value)], className)}>
      {Math.round(value * 100)}%
    </span>
  );
}

const CITATION_TONE = {
  grounded: "success",
  best_effort: "neutral",
  insufficient_evidence: "warning",
  extraction_error: "danger",
} as const satisfies Record<string, StatusTone>;

const CITATION_LABEL = {
  grounded: "grounded",
  best_effort: "bestEffort",
  insufficient_evidence: "insufficientEvidence",
  extraction_error: "extractionError",
} as const;

/** An answer's value: yes or no, a list, or text. A missing answer reads as a dash, never "null". */
export function ResultAnswer({ result, type, searchQuery = "", clamp = "line-clamp-3" }: {
  result?: ExtractionResultRecord;
  type: string;
  searchQuery?: string;
  /** How many lines long text may take. */
  clamp?: string;
}) {
  const tc = useTranslations("common");
  const answer = result?.answer;
  if (answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && !answer.length)) {
    return <span className="text-sm text-muted-foreground/60">—</span>;
  }
  if (type === "boolean") {
    return answer === true ? <span className="text-sm font-medium">{tc("yes")}</span>
      : answer === false ? <span className="text-sm font-medium text-muted-foreground">{tc("no")}</span>
      : <span className="text-sm text-muted-foreground">{tc("unknown")}</span>;
  }
  if (Array.isArray(answer)) {
    return (
      <div className="flex flex-wrap gap-1">
        {answer.map((item) => (
          <Badge key={String(item)} variant="outline" className="text-xs font-normal">
            <HighlightedText text={String(item)} query={searchQuery} />
          </Badge>
        ))}
      </div>
    );
  }
  return (
    <p className={cn("text-sm leading-relaxed text-foreground/90", clamp)}>
      <HighlightedText text={String(answer)} query={searchQuery} />
    </p>
  );
}

/** How sure the answer is and how well the paper backs it. */
export function ResultMeta({ result }: { result?: ExtractionResultRecord }) {
  const tc = useTranslations("common");
  if (!result) return null;
  const status = getCitationStatus(result);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A missing answer has no confidence worth showing. */}
      {result.confidence ? <ConfidenceValue value={result.confidence} /> : null}
      {status && status in CITATION_TONE ? (
        <StatusChip tone={CITATION_TONE[status as keyof typeof CITATION_TONE]}>
          {tc(CITATION_LABEL[status as keyof typeof CITATION_LABEL])}
        </StatusChip>
      ) : null}
    </div>
  );
}

/** The model's reasoning and the supporting citation, as small icon buttons. */
export function ResultActions({ result, onCite, searchQuery = "", className }: {
  result?: ExtractionResultRecord;
  onCite?: () => void;
  searchQuery?: string;
  className?: string;
}) {
  const tc = useTranslations("common");
  if (!result) return null;
  const hasCitation = getAllCitationLocations(result).length > 0;
  if (!result.reasoning && !(hasCitation && onCite)) return null;
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {result.reasoning ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={tc("reasoning")} title={tc("reasoning")}>
              <Maximize2 className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-1 p-4 text-xs leading-relaxed">
            <p className="font-medium">{tc("reasoning")}</p>
            <p className="text-muted-foreground"><HighlightedText text={result.reasoning} query={searchQuery} /></p>
          </PopoverContent>
        </Popover>
      ) : null}
      {hasCitation && onCite ? (
        <Button variant="ghost" size="icon-xs" onClick={onCite} className="text-muted-foreground hover:text-foreground" aria-label={tc("viewCitation")} title={tc("viewCitation")}>
          <Quote className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

/** A paper's year, DOI and what the answers were read from. */
export function PaperDetails({ paper, pdfEnabled }: { paper: PaperWithResults; pdfEnabled: boolean }) {
  const tc = useTranslations("common");
  const hasAbstract = !!paper.abstract && paper.abstract.length > MIN_ABSTRACT_LENGTH;
  const hasPdfSource = !!paper.pdfUrl || !!paper.storageId || !!paper.ragEntryId || !!paper.isIndexed;
  const noContent = paper.status === "download_failed" && !hasAbstract;
  const abstractOnly = hasAbstract && !paper.pdfContentUsed && !paper.isIndexed && !paper.ragEntryId && paper.status !== "download_failed";
  const sources = [
    paper.isOpenAccess && tc("openAccess"),
    pdfEnabled && (paper.isIndexed || paper.ragEntryId) && tc("indexed"),
    pdfEnabled && paper.pdfContentUsed && tc("pdfUsed"),
    abstractOnly && (!paper.isOpenAccess && !hasPdfSource ? tc("abstractOnly") : tc("abstract")),
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {paper.publicationYear ? <span className="tabular-nums">{paper.publicationYear}</span> : null}
      {paper.doi ? (
        <a
          href={`https://doi.org/${paper.doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          DOI <ExternalLink className="size-2.5" />
        </a>
      ) : null}
      {noContent ? <StatusChip tone="danger">{tc("noContent")}</StatusChip> : null}
      {sources.map((source) => <span key={String(source)}>{source}</span>)}
    </div>
  );
}
