"use client";

import { useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { CitationLocation, CitationStatus } from "@/lib/extraction/citations";
import { PdfCitationPanel } from "@/components/extraction/pdf-citation-panel";

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
  const payload = useMemo(() => {
    if (!paperId || !Array.isArray(citations)) return null;
    return {
      paperId,
      paperTitle,
      citations,
      citationStatus,
      answerText: answerText ?? null,
      questionText: questionText ?? null,
    };
  }, [paperId, paperTitle, citations, citationStatus, answerText, questionText]);

  void onOpenChange;

  if (!open) return null;

  return (
    <PdfCitationPanel payload={payload} />
  );
}
