"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { parseContextChunk } from "@/lib/extraction/citations";
const PdfViewer = dynamic(
  () => import("@/components/extraction/pdf-viewer").then((mod) => mod.PdfViewer),
  { ssr: false },
);

type PdfCitationDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paperId: Id<"extractionPapers"> | null;
  paperTitle: string | null;
  citationChunk: string | null;
  answerText?: string | null;
  questionText?: string | null;
};

export function PdfCitationDrawer({
  open,
  onOpenChange,
  paperId,
  paperTitle,
  citationChunk,
  answerText,
  questionText,
}: PdfCitationDrawerProps) {
  const pdfUrl = useQuery(
    api.extraction.queries.getPaperPdfUrl,
    paperId ? { paperId } : "skip",
  );

  const citation = useMemo(
    () => (citationChunk ? parseContextChunk(citationChunk) : null),
    [citationChunk],
  );

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
          {citation?.text ? (
            <p className="text-xs text-muted-foreground line-clamp-3">
              {citation.text}
            </p>
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
              answerText={answerText}
              questionText={questionText}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
