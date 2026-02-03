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
  answerText?: string | null;
  questionText?: string | null;
};

const MAX_RANGE_RATIO = 0.6;
const MAX_RANGE_CHARS = 1400;
const MIN_MATCH_CHARS = 40;
const MIN_ANSWER_MATCH_CHARS = 12;
const SENTENCE_WINDOW_LIMIT = 900;
const DEBUG_PDF_HIGHLIGHT = false;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "from",
  "were",
  "was",
  "this",
  "what",
  "which",
  "who",
  "how",
  "many",
  "much",
  "where",
  "when",
  "into",
  "about",
  "does",
  "did",
  "are",
  "is",
  "its",
  "their",
  "study",
  "paper",
  "results",
  "methods",
  "analysis",
  "data",
  "using",
]);

type TextMatch = {
  start: number;
  end: number;
};

const debugLog = (...args: Parameters<typeof console.info>) => {
  if (!DEBUG_PDF_HIGHLIGHT) return;
  console.info(...args);
};

type NormalizationResult = {
  normalized: string;
  mapping: number[];
};

function normalizeForMatch(text: string): NormalizationResult {
  const normalized: string[] = [];
  const mapping: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "-" && next === "\n") {
      i += 1;
      continue;
    }
    if (char === "\u00ad") {
      continue;
    }
    const lower = char.toLowerCase();
    const isAlphaNum = /[a-z0-9]/.test(lower);

    if (isAlphaNum) {
      normalized.push(lower);
      mapping.push(i);
      lastWasSpace = false;
      continue;
    }

    if (!lastWasSpace) {
      normalized.push(" ");
      mapping.push(i);
      lastWasSpace = true;
    }
  }

  return {
    normalized: normalized.join(""),
    mapping,
  };
}

function findMatchInText(pageText: string, needle: string | undefined): TextMatch | null {
  if (!needle) return null;
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const normalizedPage = normalizeForMatch(pageText);
  const normalizedNeedle = normalizeForMatch(trimmed);
  const pattern = normalizedNeedle.normalized.trim();
  if (!pattern) return null;

  const matchIndex = normalizedPage.normalized.indexOf(pattern);
  if (matchIndex < 0) return null;

  const startOriginal = normalizedPage.mapping[matchIndex];
  const endMapIndex = Math.min(
    matchIndex + pattern.length - 1,
    normalizedPage.mapping.length - 1,
  );
  const endOriginal = normalizedPage.mapping[endMapIndex] + 1;

  if (!Number.isFinite(startOriginal) || !Number.isFinite(endOriginal)) return null;
  return { start: startOriginal, end: endOriginal };
}

function trimRangeToSentenceWindow(
  pageText: string,
  match: TextMatch,
  limit = SENTENCE_WINDOW_LIMIT,
): TextMatch {
  const windowSize = Math.min(limit, pageText.length);
  const center = Math.max(0, Math.min(pageText.length, match.start));
  let windowStart = Math.max(0, center - Math.floor(windowSize / 2));
  let windowEnd = Math.min(pageText.length, windowStart + windowSize);
  if (windowEnd - windowStart < windowSize) {
    windowStart = Math.max(0, windowEnd - windowSize);
  }

  const windowText = pageText.slice(windowStart, windowEnd);
  const relativeStart = match.start - windowStart;
  let sentenceStart = windowText.lastIndexOf(".", relativeStart);
  sentenceStart = sentenceStart === -1 ? windowText.lastIndexOf("?", relativeStart) : sentenceStart;
  sentenceStart = sentenceStart === -1 ? windowText.lastIndexOf("!", relativeStart) : sentenceStart;
  sentenceStart = sentenceStart === -1 ? windowText.lastIndexOf("\n", relativeStart) : sentenceStart;
  sentenceStart = sentenceStart === -1 ? 0 : sentenceStart + 1;
  let sentenceEnd = windowText.indexOf(".", relativeStart + 1);
  sentenceEnd = sentenceEnd === -1 ? windowText.indexOf("?", relativeStart + 1) : sentenceEnd;
  sentenceEnd = sentenceEnd === -1 ? windowText.indexOf("!", relativeStart + 1) : sentenceEnd;
  sentenceEnd = sentenceEnd === -1 ? windowText.indexOf("\n", relativeStart + 1) : sentenceEnd;
  sentenceEnd = sentenceEnd === -1 ? windowText.length : sentenceEnd + 1;

  const trimmedStart = windowStart + sentenceStart;
  const trimmedEnd = windowStart + sentenceEnd;

  if (trimmedEnd - trimmedStart < MIN_MATCH_CHARS) {
    return match;
  }

  return {
    start: trimmedStart,
    end: trimmedEnd,
  };
}

function findBestMatchRange(params: {
  pageText: string;
  citationText?: string;
  answerText?: string | null;
  charRange?: [number, number];
  questionText?: string | null;
}): TextMatch | null {
  const { pageText, citationText, answerText, charRange } = params;
  const textLength = pageText.length;

  const isCharRangeValid =
    Array.isArray(charRange) &&
    charRange.length === 2 &&
    Number.isFinite(charRange[0]) &&
    Number.isFinite(charRange[1]);

  let normalizedRange: TextMatch | null = null;
  if (isCharRangeValid) {
    const start = Math.max(0, Math.min(textLength, charRange[0]));
    const end = Math.max(start, Math.min(textLength, charRange[1]));
    normalizedRange = { start, end };
  }

  const rangeLength = normalizedRange ? normalizedRange.end - normalizedRange.start : 0;
  const isRangeTooLarge =
    normalizedRange &&
    (rangeLength > MAX_RANGE_CHARS || rangeLength / Math.max(textLength, 1) > MAX_RANGE_RATIO);

  if (answerText && answerText.trim().length >= MIN_ANSWER_MATCH_CHARS) {
    const answerMatch = findMatchInText(pageText, answerText);
    if (answerMatch) {
      return trimRangeToSentenceWindow(pageText, answerMatch);
    }
  }

  if (normalizedRange && !isRangeTooLarge) {
    return normalizedRange;
  }

  const citationSnippet = getCitationSnippet(
    citationText,
    answerText,
    params.questionText ?? null,
  );
  const citationMatch = findMatchInText(pageText, citationSnippet);
  if (citationMatch) {
    return trimRangeToSentenceWindow(pageText, citationMatch);
  }

  if (normalizedRange && isRangeTooLarge) {
    const sentenceMatch = findSentenceMatchInRange(
      pageText,
      normalizedRange,
      params.questionText ?? null,
      answerText ?? null,
    );
    if (sentenceMatch) {
      return trimRangeToSentenceWindow(pageText, sentenceMatch);
    }
  }

  if (normalizedRange && rangeLength > MIN_MATCH_CHARS) {
    return trimRangeToSentenceWindow(pageText, normalizedRange);
  }

  return null;
}

function getCitationSnippet(
  citationText?: string,
  answerText?: string | null,
  questionText?: string | null,
) {
  if (!citationText) return undefined;
  const normalizedCitation = citationText.replace(/\s+/g, " ").trim();
  if (!normalizedCitation) return undefined;

  if (answerText && answerText.trim().length >= 3) {
    const answer = answerText.trim();
    const lowerCitation = normalizedCitation.toLowerCase();
    const lowerAnswer = answer.toLowerCase();
    const index = lowerCitation.indexOf(lowerAnswer);
    if (index >= 0) {
      const start = Math.max(0, index - 120);
      const end = Math.min(normalizedCitation.length, index + lowerAnswer.length + 120);
      return normalizedCitation.slice(start, end);
    }
  }

  const candidate = pickBestSentence(normalizedCitation, questionText, answerText);
  if (candidate) {
    return candidate.slice(0, 260);
  }

  return normalizedCitation.slice(0, 260);
}

function findSentenceMatchInRange(
  pageText: string,
  range: TextMatch,
  questionText?: string | null,
  answerText?: string | null,
) {
  const slice = pageText.slice(range.start, range.end);
  const candidate = pickBestSentence(slice, questionText, answerText);
  if (!candidate) return null;
  const localIndex = slice.indexOf(candidate);
  if (localIndex < 0) return null;
  return {
    start: range.start + localIndex,
    end: range.start + localIndex + candidate.length,
  };
}

function pickBestSentence(
  text: string,
  questionText?: string | null,
  answerText?: string | null,
) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  if (matches.length === 0) return null;

  const keywords = getKeywordTokens(questionText, answerText);
  let best: { sentence: string; score: number } | null = null;

  for (const raw of matches) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const lenScore = Math.min(sentence.length, 260);
    const digitScore = (sentence.match(/\d/g) || []).length * 12;
    const keywordScore = keywords.reduce((sum, token) =>
      sentence.toLowerCase().includes(token) ? sum + 18 : sum
    , 0);
    const score = lenScore + digitScore + keywordScore;
    if (!best || score > best.score) {
      best = { sentence, score };
    }
  }

  return best?.sentence ?? null;
}

function getKeywordTokens(questionText?: string | null, answerText?: string | null) {
  const tokens = [
    ...extractTokens(questionText),
    ...extractTokens(answerText),
  ];
  return Array.from(new Set(tokens));
}

function extractTokens(text?: string | null) {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

  return cleaned.filter((token) => !STOPWORDS.has(token));
}

function splitSpanText(
  span: HTMLElement,
  localStart: number,
  localEnd: number,
) {
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

  if (before) {
    span.append(document.createTextNode(before));
  }

  if (middle) {
    const mark = document.createElement("span");
    mark.className = "citation-highlight";
    mark.textContent = middle;
    span.append(mark);
  }

  if (after) {
    span.append(document.createTextNode(after));
  }
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
  citationText,
  answerText,
  questionText,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(false);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1.2);

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
      const textContent = await pageProxy.getTextContent();
      const items = (textContent.items as Array<{
        str?: string;
        hasEOL?: boolean;
      }>).filter((item) => typeof item.str === "string");
      const textItems = items.map((item) => ({
        str: item.str || "",
        hasEOL: item.hasEOL,
      }));
      const { text: pageText, ranges } = buildPageTextFromItems(textItems);

      const match = findBestMatchRange({
        pageText,
        citationText,
        answerText,
        charRange,
        questionText,
      });

      debugLog("[PdfViewer] match", {
        pageNumber,
        match,
        pageLength: pageText.length,
        answerText: answerText?.slice(0, 40),
        questionText: questionText?.slice(0, 40),
      });

      const viewport = pageProxy.getViewport({ scale });

      if (!match) {
        if (!cancelled) {
          setPageSize({ width: viewport.width, height: viewport.height });
        }
        return;
      }

      const intersecting = findIntersectingItems(ranges, [match.start, match.end]);

      const textLayer = containerRef.current?.querySelector(
        ".textLayer",
      ) as HTMLElement | null;
      const spanNodes = textLayer
        ? Array.from(textLayer.querySelectorAll("span[role='presentation']"))
        : [];

      if (textLayer && spanNodes.length > 0) {
        spanNodes.forEach((span) => clearSpanHighlight(span as HTMLElement));

        for (const range of intersecting) {
          const span = spanNodes[range.index] as HTMLElement | undefined;
          if (!span) continue;
          const localStart = Math.max(0, match.start - range.start);
          const localEnd = Math.min(
            span.dataset.originalText?.length ?? span.textContent?.length ?? 0,
            match.end - range.start,
          );
          if (localEnd <= localStart) continue;
          splitSpanText(span, localStart, localEnd);
        }
      }

      if (!cancelled) {
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    }

    buildHighlights();
    return () => {
      cancelled = true;
    };
  }, [pageProxy, charRange, citationText, answerText, questionText, scale, textLayerReady]);

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
            onLoadSuccess={(page: PDFPageProxy) => setPageProxy(page)}
            onRenderTextLayerSuccess={() => setTextLayerReady(true)}
          />
        </Document>
      </div>
    </div>
  );
}
