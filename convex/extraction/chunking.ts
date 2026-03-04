"use node";

/**
 * PDF chunking with page metadata and character indexing.
 * Chunks are generated from exact page substrings so char ranges stay aligned.
 */

import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";

export interface ChunkMetadata {
  page: number;
  charRange: [number, number];
  totalPages: number;
  chunkIndex: number;
}

export interface ChunkWithMetadata {
  text: string;
  metadata: ChunkMetadata;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

type ChunkSpan = {
  text: string;
  start: number;
  end: number;
};

const TARGET_CHUNK_SIZE = 700;
const MAX_CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;
const MIN_CHUNK_SIZE = 80;

function isWhitespace(char: string | undefined) {
  return !char || /\s/.test(char);
}

function findPreferredBoundary(text: string, softEnd: number, hardEnd: number) {
  // Best: paragraph boundary.
  for (let i = hardEnd; i > softEnd; i--) {
    if (text[i - 1] === "\n" && text[i - 2] === "\n") return i;
  }

  // Next: sentence boundary.
  for (let i = hardEnd; i > softEnd; i--) {
    const prev = text[i - 1];
    if (/[.!?]/.test(prev) && isWhitespace(text[i])) return i;
  }

  // Next: line boundary.
  for (let i = hardEnd; i > softEnd; i--) {
    if (text[i - 1] === "\n") return i;
  }

  // Last: any whitespace.
  for (let i = hardEnd; i > softEnd; i--) {
    if (isWhitespace(text[i - 1])) return i;
  }

  return hardEnd;
}

function chunkTextSimple(
  text: string,
  options: {
    pageNum?: number;
    targetChunkSize?: number;
    maxChunkSize?: number;
    overlapSize?: number;
  } = {}
): ChunkSpan[] {
  const {
    pageNum = 0,
    targetChunkSize = TARGET_CHUNK_SIZE,
    maxChunkSize = MAX_CHUNK_SIZE,
    overlapSize = CHUNK_OVERLAP,
  } = options;

  if (typeof text !== "string") {
    console.warn(
      `[chunkTextSimple] Page ${pageNum + 1}: Invalid text type "${typeof text}"`
    );
    return [];
  }

  if (text.trim().length === 0) {
    console.log(`[chunkTextSimple] Page ${pageNum + 1}: Empty text`);
    return [];
  }

  const spans: ChunkSpan[] = [];
  const textLength = text.length;
  let cursor = 0;

  while (cursor < textLength) {
    while (cursor < textLength && isWhitespace(text[cursor])) {
      cursor++;
    }
    if (cursor >= textLength) break;

    const remaining = textLength - cursor;
    let end: number;

    if (remaining <= maxChunkSize) {
      end = textLength;
    } else {
      const softEnd = Math.min(textLength, cursor + targetChunkSize);
      const hardEnd = Math.min(textLength, cursor + maxChunkSize);
      end = findPreferredBoundary(text, softEnd, hardEnd);
      if (end <= cursor) {
        end = hardEnd;
      }
    }

    let startTrimmed = cursor;
    let endTrimmed = end;
    while (startTrimmed < endTrimmed && isWhitespace(text[startTrimmed])) {
      startTrimmed++;
    }
    while (endTrimmed > startTrimmed && isWhitespace(text[endTrimmed - 1])) {
      endTrimmed--;
    }

    if (endTrimmed - startTrimmed >= MIN_CHUNK_SIZE) {
      spans.push({
        text: text.slice(startTrimmed, endTrimmed),
        start: startTrimmed,
        end: endTrimmed,
      });
    }

    if (end >= textLength) break;

    cursor = Math.max(startTrimmed + 1, end - overlapSize);
  }

  console.log(`[chunkTextSimple] Page ${pageNum + 1}: Created ${spans.length} chunks`);
  return spans;
}

/**
 * Extract text from PDF buffer using pdfjs.
 */
export async function extractTextByPages(
  pdfBuffer: ArrayBuffer
): Promise<{ pages: ExtractedPage[]; totalPages: number }> {
  console.log(`[extractTextByPages] Starting extraction (${pdfBuffer.byteLength} bytes)`);

  const { extractPdfJsTextPages } = await import("./pdfjs_extract");
  const { pages, totalPages } = await extractPdfJsTextPages(pdfBuffer);

  const extractedPages: ExtractedPage[] = pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: buildPageTextFromItems(page.items).text,
  }));

  console.log(`[extractTextByPages] Extracted ${extractedPages.length}/${totalPages} pages`);

  return {
    pages: extractedPages,
    totalPages,
  };
}

/**
 * Chunk pages with metadata, preserving original PDF page numbers.
 */
export function chunkPagesWithMetadata(
  pages: ExtractedPage[],
  totalPages: number,
  options: {
    targetChunkSize?: number;
    maxChunkSize?: number;
    overlapSize?: number;
  } = {}
): ChunkWithMetadata[] {
  const chunks: ChunkWithMetadata[] = [];
  let globalChunkIndex = 0;

  console.log(`[chunkPagesWithMetadata] Processing ${pages.length} pages`);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageSpans = chunkTextSimple(page.text, {
      pageNum: page.pageNumber - 1,
      targetChunkSize: options.targetChunkSize,
      maxChunkSize: options.maxChunkSize,
      overlapSize: options.overlapSize,
    });

    if (pageSpans.length === 0) {
      console.log(`[chunkPagesWithMetadata] Page ${page.pageNumber}: No usable chunks`);
      continue;
    }

    for (const span of pageSpans) {
      chunks.push({
        text: span.text,
        metadata: {
          page: page.pageNumber,
          charRange: [span.start, span.end],
          totalPages,
          chunkIndex: globalChunkIndex++,
        },
      });
    }

    console.log(
      `[chunkPagesWithMetadata] Page ${page.pageNumber}: ${pageSpans.length} chunks`
    );
  }

  console.log(`[chunkPagesWithMetadata] Total: ${chunks.length} chunks`);
  return chunks;
}

/**
 * Main extraction function.
 */
export async function extractAndChunkPdf(
  pdfBuffer: ArrayBuffer,
  options?: {
    targetChunkSize?: number;
    maxChunkSize?: number;
    overlapSize?: number;
  }
): Promise<ChunkWithMetadata[]> {
  console.log(`[extractAndChunkPdf] Starting (${pdfBuffer.byteLength} bytes)`);

  try {
    const { pages, totalPages } = await extractTextByPages(pdfBuffer);
    if (pages.length === 0) {
      console.warn(`[extractAndChunkPdf] No pages extracted`);
      return [];
    }

    const chunks = chunkPagesWithMetadata(pages, totalPages, options);
    console.log(`[extractAndChunkPdf] Complete: ${chunks.length} chunks`);
    return chunks;
  } catch (error) {
    console.error(`[extractAndChunkPdf] Error: ${error}`);
    throw error;
  }
}

/**
 * Format chunk for legacy display.
 */
export function formatChunkWithMetadata(chunk: ChunkWithMetadata): string {
  const { page, charRange } = chunk.metadata;
  const [start, end] = charRange;
  return `[Page ${page}, chars ${start}-${end}]
${chunk.text}`;
}

/**
 * Prepare chunk format for Convex RAG component.
 */
export function prepareChunksForRag(
  chunks: ChunkWithMetadata[]
): Array<{ text: string; metadata: ChunkMetadata }> {
  return chunks.map((chunk) => ({
    text: chunk.text,
    metadata: {
      page: chunk.metadata.page,
      charRange: chunk.metadata.charRange,
      totalPages: chunk.metadata.totalPages,
      chunkIndex: chunk.metadata.chunkIndex,
    },
  }));
}
