"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, PanelLeftOpen, Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipHint } from "@/components/ui/tooltip";
import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { MIN_ABSTRACT_LENGTH } from "@/convex/extraction/content";
import { getAllCitationLocations, getCitationStatus } from "@/lib/extraction/citations";
import type { ExtractionResultRecord, PaperWithResults } from "@/lib/extraction/filtering";
import { cn } from "@/lib/utils";
import { HighlightedText } from "./highlighted-text";

// The pieces every results view shares, so a table cell, a card and the split
// view say the same thing the same way.

const CONFIDENCE_TEXT: Record<StatusTone, string> = {
  success: "ink-success",
  warning: "ink-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
  running: "text-primary",
};

function confidenceTone(value?: number): StatusTone {
  if (!value) return "neutral";
  return value >= 0.8 ? "success" : value >= 0.5 ? "warning" : "danger";
}

/** How sure the answers a paper got are, leaving out questions it had no answer for. */
export function answeredConfidence(paper: PaperWithResults): number | undefined {
  const scores = paper.results.map((r) => r.confidence ?? 0).filter((c) => c > 0);
  return scores.length ? scores.reduce((sum, c) => sum + c, 0) / scores.length : undefined;
}

/** A confidence between 0 and 1, as a coloured percentage. */
export function ConfidenceValue({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("text-xs font-medium tabular-nums", CONFIDENCE_TEXT[confidenceTone(value)], className)}>
      {Math.round(value * 100)}%
    </span>
  );
}

/** An answer's value: yes or no, a list, or text. With no answer it says why, in words. */
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
    const status = getCitationStatus(result);
    return (
      <span className={cn("text-sm", status === "extraction_error" ? "text-destructive" : "text-muted-foreground")}>
        {status === "extraction_error" ? tc("extractionError") : status === "insufficient_evidence" ? tc("insufficientEvidence") : "—"}
      </span>
    );
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
          <TooltipHint key={String(item)} label={String(item)} onlyWhenClipped>
            <Badge variant="outline" className="max-w-full text-xs font-normal">
              <span className="truncate"><HighlightedText text={String(item)} query={searchQuery} /></span>
            </Badge>
          </TooltipHint>
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

/** How far to trust an answer, as one quiet line: its confidence and whether the paper backs it. */
export function ResultMeta({ result }: { result?: ExtractionResultRecord }) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const status = getCitationStatus(result);
  // A missing answer already says why in its place, so it needs no second line.
  if (!result || !result.confidence) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <span className={cn("font-medium tabular-nums", CONFIDENCE_TEXT[confidenceTone(result.confidence)])}>
        {Math.round(result.confidence * 100)}% {t("confidence")}
      </span>
      {status === "grounded" ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Quote aria-hidden className="size-3 ink-success" />
          {tc("grounded")}
        </span>
      ) : status === "best_effort" ? (
        <span className="text-muted-foreground">{tc("bestEffort")}</span>
      ) : null}
    </p>
  );
}

/**
 * One answer in a table cell or card: the value and how far to trust it. The
 * whole cell opens the answer's side panel, and says so on hover.
 */
export function ResultCell({ result, type, searchQuery = "", clamp, selected = false, onOpen, fill = false, label }: {
  result?: ExtractionResultRecord;
  type: string;
  searchQuery?: string;
  clamp?: string;
  /** The answer shown in the side panel right now. */
  selected?: boolean;
  onOpen: () => void;
  /**
   * In a table cell: the click area and hover stretch over the whole cell
   * (which must be `relative isolate`), behind the text.
   */
  fill?: boolean;
  /** The question, shown above the answer inside the button so they highlight together. */
  label?: string;
}) {
  if (!result) return <ResultAnswer result={result} type={type} />;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "group/cell block space-y-1.5 text-left",
        fill
          ? cn(
              "static w-full outline-none after:absolute after:inset-0 after:-z-10 after:transition-colors after:duration-100 hover:after:bg-muted/60 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring",
              selected && "after:bg-primary/5 after:ring-1 after:ring-inset after:ring-primary/30 hover:after:bg-primary/10",
            )
          : cn(
              "relative -mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 pr-7 transition-colors duration-100 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
              selected && "bg-primary/5 ring-1 ring-primary/30 hover:bg-primary/10",
            ),
      )}
    >
      {label ? (
        <TooltipHint label={label} onlyWhenClipped>
          <span className="block truncate text-xs text-muted-foreground">{label}</span>
        </TooltipHint>
      ) : null}
      <ResultAnswer result={result} type={type} searchQuery={searchQuery} clamp={clamp} />
      <ResultMeta result={result} />
      <PanelLeftOpen
        aria-hidden
        className={cn(
          "absolute size-3.5 text-muted-foreground transition-opacity duration-100",
          fill ? "right-3.5 top-4.5" : "right-2 top-2",
          selected ? "text-primary opacity-100" : "opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100",
        )}
      />
    </button>
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
