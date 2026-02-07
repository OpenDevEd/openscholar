"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { buildPageTextFromItems } from "@/lib/extraction/pdfjs-text";
import { findIntersectingItems } from "@/lib/extraction/pdf-highlight";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfViewerProps = {
  pdfUrl: string;
  pageNumber: number;
  charRange?: [number, number];
  citationText?: string;
  citationValidated?: boolean;
  answerText?: string | null;
  questionText?: string | null;
};

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
  pageNumber,
  charRange,
  citationValidated,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(false);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [rangeUnavailable, setRangeUnavailable] = useState(false);
  const [scale, setScale] = useState(1.2);

  useEffect(() => {
    setTextLayerReady(false);
    setRangeUnavailable(false);
  }, [pageNumber, scale, pdfUrl, charRange, citationValidated]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageNumber]);

  useEffect(() => {
    let cancelled = false;

    async function buildHighlights() {
      if (!pageProxy || !textLayerReady) return;

      const viewport = pageProxy.getViewport({ scale });

      const textLayer = containerRef.current?.querySelector(".textLayer") as HTMLElement | null;
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
        spanNodes.forEach((span) => clearSpanHighlight(span as HTMLElement));
      }

      if (!citationValidated) {
        if (!cancelled) {
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
      for (let i = 0; i < textItems.length; i++) {
        if ((textItems[i].str || "").length > 0) {
          renderableItemIndexes.push(i);
        }
      }
      const itemIndexToSpanIndex = new Map<number, number>();
      for (let spanIndex = 0; spanIndex < renderableItemIndexes.length; spanIndex++) {
        itemIndexToSpanIndex.set(renderableItemIndexes[spanIndex], spanIndex);
      }

      let resolvedRange: [number, number] | null = null;
      if (charRange) {
        const start = Math.max(0, Math.min(pageText.length, Number(charRange[0] ?? 0)));
        const end = Math.max(start, Math.min(pageText.length, Number(charRange[1] ?? start)));
        if (end > start) {
          resolvedRange = [start, end];
        }
      }

      if (!resolvedRange) {
        if (!cancelled) {
          setRangeUnavailable(true);
          setPageSize({ width: viewport.width, height: viewport.height });
        }
        return;
      }

      const [start, end] = resolvedRange;
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
            mappedSpanIndex !== undefined ? (spanNodes[mappedSpanIndex] as HTMLElement | undefined) : undefined;
          if (!span) continue;
          const localStart = Math.max(0, start - range.start);
          const localEnd = Math.min(
            span.dataset.originalText?.length ?? span.textContent?.length ?? 0,
            end - range.start,
          );
          if (localEnd <= localStart) continue;
          splitSpanText(span, localStart, localEnd);
          appliedHighlights++;
        }
      }

      if (!cancelled) {
        setRangeUnavailable(appliedHighlights === 0);
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    }

    buildHighlights();

    return () => {
      cancelled = true;
    };
  }, [pageProxy, textLayerReady, charRange, citationValidated, scale]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
        <span>Page {pageNumber}</span>
        <button
          type="button"
          onClick={() => setScale((value) => Math.min(value + 0.1, 2))}
          className="px-2 py-0.5 rounded border border-border hover:bg-muted"
        >
          Zoom +
        </button>
        <button
          type="button"
          onClick={() => setScale((value) => Math.max(value - 0.1, 0.8))}
          className="px-2 py-0.5 rounded border border-border hover:bg-muted"
        >
          Zoom -
        </button>
      </div>
      {citationValidated && rangeUnavailable ? (
        <div className="pb-2 text-xs text-amber-600 dark:text-amber-400">
          Citation range unavailable for this result.
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="relative"
        style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
      >
        <Document file={pdfUrl} loading={<div className="text-sm">Loading PDF…</div>}>
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer
            renderAnnotationLayer={false}
            onLoadSuccess={(page: PDFPageProxy) => setPageProxy(page)}
            onRenderTextLayerSuccess={() => setTextLayerReady(true)}
          />
        </Document>
      </div>
    </div>
  );
}
