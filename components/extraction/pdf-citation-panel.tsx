"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ExternalLink, ChevronDown, ChevronUp, Loader2 } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

function CitationTextBlock({
  citation,
  isLongCitation,
}: {
  citation: { text: string };
  isLongCitation: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations();
  return (
    <div className="mt-1.5">
      <p
        className={cn(
          "text-2xs leading-relaxed text-muted-foreground",
          !expanded && "line-clamp-2"
        )}
      >
        {citation.text}
      </p>
      {isLongCitation ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-2xs"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <>
              {t("common.showLess")}
              <ChevronUp className="size-3" />
            </>
          ) : (
            <>
              {t("common.showMore")}
              <ChevronDown className="size-3" />
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

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
  const t = useTranslations();
  const pdfUrlQuery = useProtectedQuery(
    api.extraction.queries.papers.pdfUrl,
    payload?.paperId ? { paperId: payload.paperId } : "skip",
  );
  const pdfUrlResult = pdfUrlQuery.data;
  const pdfUrl = pdfUrlResult?.status === "ok" ? pdfUrlResult.pdfUrl : null;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const effectiveSelectedIndex = payload
    ? Math.min(selectedIndex, Math.max(0, payload.citations.length - 1))
    : 0;

  const citation = payload?.citations[effectiveSelectedIndex] || null;
  const shouldRenderPdfViewer =
    !pdfUrlQuery.isDeferred && Boolean(pdfUrl) && Boolean(citation);

  const isLongCitation = (citation?.text?.length || 0) > 260;

  if (!payload) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('pdfViewer.noCitationSelected')}</p>
          <p className="text-xs text-muted-foreground">
            {t('pdfViewer.openCitationHint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="@container/citation flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 bg-background/95 px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold">{t('common.citation')}</h3>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {citation ? (
              <span className="text-xs tabular-nums text-muted-foreground">p.{citation.page}</span>
            ) : null}
            {pdfUrl ? (
              <Button
                variant="outline"
                size="icon"
                onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")}
                className="h-7 w-7"
                aria-label={t('accessibility.openPdfNewTab')}
              >
                <ExternalLink className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>

        {citation?.text ? (
          <CitationTextBlock
            key={effectiveSelectedIndex}
            citation={citation}
            isLongCitation={isLongCitation}
          />
        ) : null}

        {payload.citations.length > 1 ? (
          <div className="mt-1.5 flex max-w-full flex-wrap gap-1">
            {payload.citations.map((item, index) => (
              <button
                key={`${item.page}-${item.charRange[0]}-${item.charRange[1]}`}
                type="button"
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-3xs font-medium transition-colors",
                  index === effectiveSelectedIndex
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
        {pdfUrlQuery.isDeferred ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('pdfViewer.checkingPdfAccess')}
          </div>
        ) : null}
        {!pdfUrlQuery.isDeferred && !pdfUrl ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            {pdfUrlResult?.status === "no_access"
              ? t('pdfViewer.noAccessToPaper')
              : pdfUrlResult?.status === "unauthenticated"
                ? t('pdfViewer.signInToViewPdf')
                : t('pdfViewer.pdfUnavailable')}
          </div>
        ) : !pdfUrlQuery.isDeferred && !citation ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            {t('pdfViewer.citationUnavailable')}
          </div>
        ) : shouldRenderPdfViewer ? (
          <PdfViewer
            key={`${pdfUrl}-${citation!.page}-${citation!.charRange?.[0] ?? 0}`}
            pdfUrl={pdfUrl!}
            initialPageNumber={citation!.page}
            highlightPage={citation!.page}
            highlightRange={citation!.charRange}
            highlightValidated={citation!.validated}
          />
        ) : null}
      </div>
    </div>
  );
}
