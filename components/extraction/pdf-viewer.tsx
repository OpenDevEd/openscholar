"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { findIntersectingItems } from "@/lib/extraction/pdf-highlight";
import { buildPageTextFromItems } from "@/lib/extraction/pdfjs-text";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfViewerProps = {
  pdfUrl: string;
  pageNumber: number;
  charRange?: [number, number];
  citationText?: string;
};

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DEBUG_PDF_HIGHLIGHT = true;
const debugLog = (...args: Parameters<typeof console.info>) => {
  console.info(...args);
};

debugLog("[PdfViewer] debug enabled");

function normalizeForMatch(text: string) {
  const normalized: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lower = char.toLowerCase();
    const isAlphaNum = /[a-z0-9]/.test(lower);

    if (isAlphaNum) {
      normalized.push(lower);
      map.push(i);
      lastWasSpace = false;
      continue;
    }

    if (!lastWasSpace) {
      normalized.push(" ");
      map.push(i);
      lastWasSpace = true;
    }
  }

  return {
    normalized: normalized.join(""),
    map,
  };
}

export function PdfViewer({
  pdfUrl,
  pageNumber,
  charRange,
  citationText,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(false);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1.2);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    setTextLayerReady(false);
  }, [pageNumber, scale, pdfUrl]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageNumber]);

  useEffect(() => {
    let cancelled = false;

    async function buildHighlights() {
      if (!pageProxy) return;
      debugLog("[PdfViewer] build highlights start", {
        pageNumber,
        textLayerReady,
        scale,
      });
      const textContent = await pageProxy.getTextContent();
      const items = (textContent.items as Array<{
        str?: string;
        hasEOL?: boolean;
        transform?: number[];
        width?: number;
        height?: number;
      }>).filter((item) => typeof item.str === "string");
      const textItems = items.map((item) => ({
        str: item.str || "",
        hasEOL: item.hasEOL,
      }));
      const { text: pageText, ranges } = buildPageTextFromItems(textItems);
      debugLog("[PdfViewer] text content", {
        pageNumber,
        items: items.length,
        textItems: textItems.length,
        ranges: ranges.length,
        pageTextLength: pageText.length,
      });

      let matchStart = -1;
      let matchEnd = -1;

      if (charRange && charRange.length === 2) {
        matchStart = Math.max(0, charRange[0]);
        matchEnd = Math.min(pageText.length, charRange[1]);
      } else if (citationText) {
        const normalizedText = normalizeForMatch(pageText);
        const normalizedSnippet = normalizeForMatch(citationText.slice(0, 160));
        const snippetValue = normalizedSnippet.normalized.trim();
        const matchIndex = snippetValue
          ? normalizedText.normalized.indexOf(snippetValue)
          : -1;
        if (matchIndex >= 0) {
          const startOriginal = normalizedText.map[matchIndex];
          const endMapIndex = Math.min(
            matchIndex + snippetValue.length - 1,
            normalizedText.map.length - 1
          );
          matchStart = startOriginal;
          matchEnd = normalizedText.map[endMapIndex] + 1;
        }
      }

      debugLog("[PdfViewer] match range", {
        pageNumber,
        matchStart,
        matchEnd,
        matchLength: matchEnd - matchStart,
        hasCharRange: Boolean(charRange),
        hasCitationText: Boolean(citationText),
      });

      if (matchStart < 0 || matchEnd <= matchStart) {
        debugLog("[PdfViewer] no match range, clearing highlights", {
          pageNumber,
        });
        if (!cancelled) {
          setHighlightRects([]);
          const viewport = pageProxy.getViewport({ scale });
          setPageSize({ width: viewport.width, height: viewport.height });
        }
        return;
      }

      const viewport = pageProxy.getViewport({ scale });
      const intersecting = findIntersectingItems(ranges, [matchStart, matchEnd]);
      const rects: HighlightRect[] = [];

      const textLayer = containerRef.current?.querySelector(
        ".textLayer"
      ) as HTMLElement | null;
      const spanNodes = textLayer
        ? Array.from(textLayer.querySelectorAll("span"))
        : [];

      debugLog("[PdfViewer] text layer", {
        pageNumber,
        hasTextLayer: Boolean(textLayer),
        spanCount: spanNodes.length,
        intersecting: intersecting.length,
      });

      if (textLayer) {
        const layerStyle = window.getComputedStyle(textLayer);
        debugLog("[PdfViewer] text layer style", {
          pageNumber,
          opacity: layerStyle.opacity,
          zIndex: layerStyle.zIndex,
          pointerEvents: layerStyle.pointerEvents,
        });
      }

      if (textLayer && spanNodes.length > 0) {
        spanNodes.forEach((span) => {
          span.classList.remove("citation-highlight");
        });
        const containerBox = containerRef.current?.getBoundingClientRect();
        const layerBox = textLayer.getBoundingClientRect();
        const offsetLeft = containerBox ? layerBox.left - containerBox.left : 0;
        const offsetTop = containerBox ? layerBox.top - containerBox.top : 0;
        let applied = 0;

        for (const range of intersecting) {
          const span = spanNodes[range.index] as HTMLElement | undefined;
          if (!span) continue;
          span.classList.add("citation-highlight");
          const spanBox = span.getBoundingClientRect();
          rects.push({
            left: spanBox.left - layerBox.left + offsetLeft,
            top: spanBox.top - layerBox.top + offsetTop,
            width: spanBox.width,
            height: spanBox.height,
          });
          applied += 1;
        }

        debugLog("[PdfViewer] highlight applied", {
          pageNumber,
          applied,
          rects: rects.length,
        });

        const sampleIndex = intersecting[0]?.index ?? 0;
        const sampleSpan = spanNodes[sampleIndex] as HTMLElement | undefined;
        if (sampleSpan) {
          const sampleStyle = window.getComputedStyle(sampleSpan);
          const sampleBox = sampleSpan.getBoundingClientRect();
          debugLog("[PdfViewer] sample span", {
            pageNumber,
            index: sampleIndex,
            text: sampleSpan.textContent?.slice(0, 80),
            className: sampleSpan.className,
            background: sampleStyle.backgroundColor,
            color: sampleStyle.color,
            width: sampleBox.width,
            height: sampleBox.height,
          });
        }
      }

      if (!cancelled) {
        debugLog("[PdfViewer] rect sample", {
          pageNumber,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          rectCount: rects.length,
          firstRect: rects[0],
        });
        setHighlightRects(rects.filter((rect) => rect.width > 0 && rect.height > 0));
        setPageSize({ width: viewport.width, height: viewport.height });
        setRenderTick((tick) => tick + 1);
      }
    }

    buildHighlights();
    return () => {
      cancelled = true;
    };
  }, [pageProxy, charRange, citationText, scale, textLayerReady]);

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
            onLoadSuccess={(page: PDFPageProxy) => {
              debugLog("[PdfViewer] page loaded", {
                pageNumber,
                pageWidth: page.view?.[2],
                pageHeight: page.view?.[3],
              });
              setPageProxy(page);
            }}
            onRenderTextLayerSuccess={() => {
              debugLog("[PdfViewer] text layer rendered", { pageNumber });
              setTextLayerReady(true);
            }}
            onGetTextSuccess={({ items }) => {
              debugLog("[PdfViewer] text items loaded", {
                pageNumber,
                items: items.length,
              });
            }}
          />
        </Document>
        <div className="pointer-events-none absolute inset-0 z-10">
          {highlightRects.map((rect, index) => (
            <div
              key={`${rect.left}-${rect.top}-${index}`}
              className="citation-highlight-rect absolute"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          ))}
        </div>
        {DEBUG_PDF_HIGHLIGHT ? (
          <div
            className="pointer-events-none absolute inset-0 z-20"
            key={`debug-${renderTick}`}
          >
            {highlightRects.map((rect, index) => (
              <div
                key={`debug-${rect.left}-${rect.top}-${index}`}
                className="absolute border border-[color:var(--pdf-highlight-border)]"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
