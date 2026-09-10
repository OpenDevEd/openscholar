"use client";
"use no memo"; // PDF sync effects: initial page, text layer, page proxy reset on deps change

import { Spinner } from "@/components/ui/spinner";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { buildPageTextFromItems } from "@/lib/extraction/pdfjs-text";
import { findIntersectingItems } from "@/lib/extraction/pdf-highlight";
import { PdfToolbar } from "@/components/extraction/pdf-toolbar";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type ScaleMode = "fit-page" | "fit-width" | "custom";

type PdfViewerProps = {
  pdfUrl: string;
  initialPageNumber: number;
  highlightPage?: number;
  highlightRange?: [number, number];
  highlightValidated?: boolean;
  onPageChange?: (page: number) => void;
};

const ZOOM_STEP = 0.1;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampPage(page: number, numPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, numPages));
}

function splitSpanText(span: HTMLElement, localStart: number, localEnd: number) {
  const original = span.dataset.originalText ?? span.textContent ?? "";
  if (!span.dataset.originalText) {
    span.dataset.originalText = original;
  }

  if (localStart <= 0 && localEnd >= original.length) {
    span.classList.add("citation-highlight");
    span.textContent = original;
    return;
  }

  const before = original.slice(0, Math.max(0, localStart));
  const middle = original.slice(Math.max(0, localStart), Math.max(0, localEnd));
  const after = original.slice(Math.max(0, localEnd));

  span.classList.remove("citation-highlight");
  span.textContent = "";

  if (before) span.append(document.createTextNode(before));

  if (middle) {
    const mark = document.createElement("span");
    mark.className = "citation-highlight";
    mark.textContent = middle;
    span.append(mark);
  }

  if (after) span.append(document.createTextNode(after));
}

function clearSpanHighlight(span: HTMLElement) {
  const original = span.dataset.originalText;
  if (original !== undefined) {
    span.textContent = original;
    delete span.dataset.originalText;
  }
  span.classList.remove("citation-highlight");
}

export function PdfViewer({
  pdfUrl,
  initialPageNumber,
  highlightPage,
  highlightRange,
  highlightValidated,
  onPageChange,
}: PdfViewerProps) {
  const t = useTranslations();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);

  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(() => Math.max(1, initialPageNumber || 1));
  const [pageInput, setPageInput] = useState(() => String(Math.max(1, initialPageNumber || 1)));

  const [textLayerReady, setTextLayerReady] = useState(false);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [rangeUnavailable, setRangeUnavailable] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const [scaleMode, setScaleMode] = useState<ScaleMode>("fit-page");
  const [customScale, setCustomScale] = useState(1);

  useEffect(() => {
    const nextPage = clampPage(initialPageNumber || 1, numPages);
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
    setScaleMode("fit-page");
  }, [initialPageNumber, numPages]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  useEffect(() => {
    if (!viewportRef.current) return;

    const element = viewportRef.current;
    const update = () => {
      setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const activeScale = useMemo(() => {
    if (scaleMode === "custom") {
      return clamp(customScale, MIN_SCALE, MAX_SCALE);
    }

    if (!pageProxy || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return clamp(customScale, MIN_SCALE, MAX_SCALE);
    }

    const baseViewport = pageProxy.getViewport({ scale: 1 });
    const availableWidth = Math.max(1, viewportSize.width - 24);
    const availableHeight = Math.max(1, viewportSize.height - 24);

    const fitPage = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
    const fitWidth = availableWidth / baseViewport.width;

    return clamp(scaleMode === "fit-width" ? fitWidth : fitPage, MIN_SCALE, MAX_SCALE);
  }, [scaleMode, customScale, pageProxy, viewportSize.width, viewportSize.height]);

  const scalePercent = Math.round(activeScale * 100);
  const canZoomOut = activeScale > MIN_SCALE + 0.001;
  const canZoomIn = activeScale < MAX_SCALE - 0.001;

  const setPage = (nextPage: number) => {
    const clamped = clampPage(nextPage, numPages);
    setCurrentPage(clamped);
    setPageInput(String(clamped));
  };

  const handlePageInputCommit = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(currentPage));
      return;
    }
    setPage(parsed);
  };

  const handleZoomIn = () => {
    setScaleMode("custom");
    setCustomScale((previous) => {
      const base = scaleMode === "custom" ? previous : activeScale;
      return clamp(base + ZOOM_STEP, MIN_SCALE, MAX_SCALE);
    });
  };

  const handleZoomOut = () => {
    setScaleMode("custom");
    setCustomScale((previous) => {
      const base = scaleMode === "custom" ? previous : activeScale;
      return clamp(base - ZOOM_STEP, MIN_SCALE, MAX_SCALE);
    });
  };

  const handleReset = () => {
    setScaleMode("fit-page");
    setCustomScale(1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setCurrentPage((prev) => {
        const next = clampPage(prev + 1, numPages);
        setPageInput(String(next));
        return next;
      });
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setCurrentPage((prev) => {
        const next = clampPage(prev - 1, numPages);
        setPageInput(String(next));
        return next;
      });
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setPage(1);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setPage(numPages);
    }
  };

  useEffect(() => {
    setTextLayerReady(false);
    setRangeUnavailable(false);
  }, [currentPage, activeScale, pdfUrl, highlightRange, highlightValidated]);

  useEffect(() => {
    setPageProxy(null);
  }, [currentPage, pdfUrl]);

  const isCitationPage = !highlightPage || currentPage === highlightPage;
  const shouldHighlight = Boolean(highlightValidated && highlightRange && isCitationPage);

  useEffect(() => {
    let cancelled = false;

    async function applyHighlights() {
      if (!pageProxy || !textLayerReady) return;

      const viewport = pageProxy.getViewport({ scale: activeScale });
      const textLayer = pageContainerRef.current?.querySelector(".textLayer") as HTMLElement | null;
      const directChildSpans = textLayer
        ? Array.from(textLayer.querySelectorAll(":scope > span"))
        : [];
      const rolePresentationSpans = textLayer
        ? Array.from(textLayer.querySelectorAll("span[role='presentation']"))
        : [];
      const spanNodes = (
        directChildSpans.length >= rolePresentationSpans.length
          ? directChildSpans
          : rolePresentationSpans
      ) as HTMLElement[];

      if (spanNodes.length > 0) {
        spanNodes.forEach((span) => clearSpanHighlight(span));
      }

      if (!shouldHighlight || !highlightRange) {
        if (!cancelled) {
          setRangeUnavailable(false);
          setPageSize({ width: viewport.width, height: viewport.height });
        }
        return;
      }

      const textContent = await pageProxy.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });

      const items = (textContent.items as Array<{ str?: string; hasEOL?: boolean }>).filter(
        (item) => typeof item.str === "string",
      );
      const textItems = items.map((item) => ({
        str: item.str || "",
        hasEOL: item.hasEOL,
      }));

      const { text: pageText, ranges } = buildPageTextFromItems(textItems);

      const renderableItemIndexes: number[] = [];
      for (let i = 0; i < textItems.length; i += 1) {
        if ((textItems[i].str || "").length > 0) {
          renderableItemIndexes.push(i);
        }
      }

      const itemIndexToSpanIndex = new Map<number, number>();
      for (let spanIndex = 0; spanIndex < renderableItemIndexes.length; spanIndex += 1) {
        itemIndexToSpanIndex.set(renderableItemIndexes[spanIndex], spanIndex);
      }

      const start = Math.max(0, Math.min(pageText.length, Number(highlightRange[0] ?? 0)));
      const end = Math.max(start, Math.min(pageText.length, Number(highlightRange[1] ?? start)));

      if (end <= start) {
        if (!cancelled) {
          setRangeUnavailable(true);
          setPageSize({ width: viewport.width, height: viewport.height });
        }
        return;
      }

      const intersecting = findIntersectingItems(ranges, [start, end]);
      let appliedHighlights = 0;

      if (textLayer && spanNodes.length > 0) {
        for (const range of intersecting) {
          const mappedSpanIndex =
            itemIndexToSpanIndex.get(range.index) ??
            (range.index < spanNodes.length ? range.index : undefined);
          const span =
            mappedSpanIndex !== undefined
              ? (spanNodes[mappedSpanIndex] as HTMLElement | undefined)
              : undefined;
          if (!span) continue;

          const localStart = Math.max(0, start - range.start);
          const localEnd = Math.min(
            span.dataset.originalText?.length ?? span.textContent?.length ?? 0,
            end - range.start,
          );

          if (localEnd <= localStart) continue;

          splitSpanText(span, localStart, localEnd);
          appliedHighlights += 1;
        }
      }

      if (!cancelled) {
        setRangeUnavailable(appliedHighlights === 0);
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    }

    applyHighlights();

    return () => {
      cancelled = true;
    };
  }, [pageProxy, textLayerReady, highlightRange, shouldHighlight, activeScale]);

  return (
    <div
      ref={rootRef}
      role="application"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="pdf-viewer-shell flex flex-col h-full min-h-0 min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      aria-label={t('accessibility.pdfViewer')}
    >
      <PdfToolbar
        currentPage={currentPage}
        numPages={numPages}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onPageInputCommit={handlePageInputCommit}
        onPageChange={setPage}
        scalePercent={scalePercent}
        scaleMode={scaleMode}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onSetScaleMode={setScaleMode}
        onResetZoom={handleReset}
      />

      <div className="border-b border-border/50 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
        {documentError ? (
          <span className="text-destructive">{t("pdfViewer.unableToLoadPdf", { error: documentError })}</span>
        ) : !highlightValidated ? (
          <span>{t("pdfViewer.noValidatedHighlight")}</span>
        ) : !isCitationPage && highlightPage ? (
          <span>{t("pdfViewer.highlightOnPage", { page: highlightPage })}</span>
        ) : rangeUnavailable ? (
          <span className="text-amber-600 dark:text-amber-400">{t("pdfViewer.citationRangeUnavailable")}</span>
        ) : (
          <span>{t("pdfViewer.keyboardNavHint")}</span>
        )}
      </div>

      <div ref={viewportRef} className="pdf-viewer-stage min-h-0 min-w-0 flex-1 overflow-auto bg-muted/20">
        <div className="mx-auto flex w-full items-start justify-center p-2">
          <div
            ref={pageContainerRef}
            className="relative"
            style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
          >
            <Document
              file={pdfUrl}
              loading={<div className="flex min-h-40 items-center justify-center"><Spinner aria-label={t("pdfViewer.loadingPdf")} className="size-6 text-primary" /></div>}
              onLoadSuccess={({ numPages: totalPages }) => {
                const safePages = Math.max(1, totalPages);
                setNumPages(safePages);
                setDocumentError(null);
                const nextPage = clampPage(currentPage, safePages);
                setCurrentPage(nextPage);
                setPageInput(String(nextPage));
              }}
              onLoadError={(error) => {
                setDocumentError(error.message || t("pdfViewer.unknownError"));
              }}
            >
              <Page
                pageNumber={currentPage}
                scale={activeScale}
                renderTextLayer
                renderAnnotationLayer={false}
                onLoadSuccess={(page: PDFPageProxy) => setPageProxy(page)}
                onRenderTextLayerSuccess={() => setTextLayerReady(true)}
              />
            </Document>
          </div>
        </div>
      </div>
    </div>
  );
}
