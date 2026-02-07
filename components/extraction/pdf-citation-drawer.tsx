"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  CitationLocation,
  CitationStatus,
} from "@/lib/extraction/citations";
const PdfViewer = dynamic(
  () => import("@/components/extraction/pdf-viewer").then((mod) => mod.PdfViewer),
  { ssr: false },
);

type PdfCitationDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paperId: Id<"extractionPapers"> | null;
  paperTitle: string | null;
  citations: CitationLocation[];
  citationStatus?: CitationStatus;
  answerText?: string | null;
  questionText?: string | null;
};

export function PdfCitationDrawer({
  open,
  onOpenChange,
  paperId,
  paperTitle,
  citations,
  citationStatus,
  answerText,
  questionText,
}: PdfCitationDrawerProps) {
  const pdfUrl = useQuery(
    api.extraction.queries.getPaperPdfUrl,
    paperId ? { paperId } : "skip",
  );

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [paperId, open]);

  useEffect(() => {
    if (selectedIndex < citations.length) return;
    setSelectedIndex(0);
  }, [citations.length, selectedIndex]);

  const citation = citations[selectedIndex] || null;
  const statusLabel =
    citationStatus === "grounded"
      ? "Grounded"
      : citationStatus === "best_effort"
        ? "Best effort"
        : citationStatus === "insufficient_evidence"
          ? "Insufficient evidence"
          : citationStatus === "extraction_error"
            ? "Extraction error"
            : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-[min(980px,95vw)] h-[92vh] flex flex-col p-0 right-0 left-auto translate-x-0"
        style={{ marginRight: 0 }}
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-lg font-semibold truncate">
              {paperTitle || "Citation"}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {statusLabel ? (
                <Badge variant="outline" className="text-[10px] font-medium">
                  {statusLabel}
                </Badge>
              ) : null}
              {pdfUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pdfUrl, "_blank")}
                >
                  Open PDF
                </Button>
              ) : null}
            </div>
          </div>
          {citation?.text ? (
            <p className="text-xs text-muted-foreground line-clamp-3">
              {citation.text}
            </p>
          ) : null}
          {citations.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {citations.map((item, index) => (
                <Button
                  key={`${item.page}-${item.charRange[0]}-${item.charRange[1]}`}
                  type="button"
                  variant={index === selectedIndex ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setSelectedIndex(index)}
                >
                  Evidence {index + 1} · p{item.page}
                </Button>
              ))}
            </div>
          ) : null}
        </DialogHeader>
        <div className="flex-1 overflow-auto px-6 py-4">
          {!pdfUrl ? (
            <div className="text-sm text-muted-foreground">PDF unavailable</div>
          ) : !citation ? (
            <div className="text-sm text-muted-foreground">
              Citation unavailable
            </div>
          ) : (
            <PdfViewer
              pdfUrl={pdfUrl}
              pageNumber={citation.page}
              charRange={citation.charRange}
              citationText={citation.text}
              citationValidated={citation.validated}
              answerText={answerText}
              questionText={questionText}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
