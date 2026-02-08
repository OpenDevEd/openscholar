"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";

const PdfViewer = dynamic(
  () => import("@/components/extraction/pdf-viewer").then((mod) => mod.PdfViewer),
  { ssr: false },
);

type PdfCitationPanelProps = {
  payload: CitationPanelPayload | null;
};

export function PdfCitationPanel({
  payload,
}: PdfCitationPanelProps) {
  const pdfUrl = useQuery(
    api.extraction.queries.getPaperPdfUrl,
    payload?.paperId ? { paperId: payload.paperId } : "skip",
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedCitation, setExpandedCitation] = useState(false);

  useEffect(() => {
    setSelectedIndex(0);
    setExpandedCitation(false);
  }, [payload?.paperId, payload?.questionText]);

  useEffect(() => {
    if (!payload) return;
    if (selectedIndex < payload.citations.length) return;
    setSelectedIndex(0);
  }, [payload, selectedIndex]);

  useEffect(() => {
    setExpandedCitation(false);
  }, [selectedIndex]);

  const citation = payload?.citations[selectedIndex] || null;
  const statusLabel =
    payload?.citationStatus === "grounded"
      ? "Grounded"
      : payload?.citationStatus === "best_effort"
        ? "Best effort"
        : payload?.citationStatus === "insufficient_evidence"
          ? "Insufficient evidence"
          : payload?.citationStatus === "extraction_error"
            ? "Extraction error"
            : null;

  const isLongCitation = (citation?.text?.length || 0) > 260;

  if (!payload) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">No citation selected</p>
          <p className="text-xs text-muted-foreground">
            Open a citation from a result row to inspect supporting evidence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="@container/citation flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold">{payload.paperTitle || "Citation"}</h3>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {statusLabel ? (
              <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wide">
                {statusLabel}
              </Badge>
            ) : null}
            {citation ? (
              <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-wide">
                p.{citation.page}
              </Badge>
            ) : null}
            {pdfUrl ? (
              <Button
                variant="outline"
                size="icon"
                onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")}
                className="h-7 w-7"
                aria-label="Open PDF in new tab"
              >
                <ExternalLink className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>

        {citation?.text ? (
          <div className="mt-1.5">
            <p
              className={cn(
                "text-[11px] leading-relaxed text-muted-foreground",
                !expandedCitation && "line-clamp-2",
              )}
            >
              {citation.text}
            </p>
            {isLongCitation ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11px]"
                onClick={() => setExpandedCitation((value) => !value)}
              >
                {expandedCitation ? (
                  <>
                    Collapse
                    <ChevronUp className="size-3" />
                  </>
                ) : (
                  <>
                    Expand
                    <ChevronDown className="size-3" />
                  </>
                )}
              </Button>
            ) : null}
          </div>
        ) : null}

        {payload.citations.length > 1 ? (
          <div className="mt-1.5 flex max-w-full flex-wrap gap-1">
            {payload.citations.map((item, index) => (
              <button
                key={`${item.page}-${item.charRange[0]}-${item.charRange[1]}`}
                type="button"
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  index === selectedIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
                onClick={() => setSelectedIndex(index)}
              >
                {index + 1}
                <span className="opacity-70">p{item.page}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-1.5">
        {!pdfUrl ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            PDF unavailable for this paper.
          </div>
        ) : !citation ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            Citation unavailable for this result.
          </div>
        ) : (
          <PdfViewer
            pdfUrl={pdfUrl}
            initialPageNumber={citation.page}
            highlightPage={citation.page}
            highlightRange={citation.charRange}
            highlightValidated={citation.validated}
          />
        )}
      </div>
    </div>
  );
}
