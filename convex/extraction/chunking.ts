"use node";

/**
 * PDF chunking with page metadata and character indexing
 * Uses simple, reliable paragraph-based chunking (NO defaultChunker)
 */

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

/**
 * Simple, reliable paragraph-based chunking
 * Completely avoids defaultChunker which causes "c is not iterable" errors
 */
function chunkTextSimple(
  text: string,
  options: {
    maxChunkSize?: number;
    pageNum?: number;
  } = {}
): string[] {
  const { maxChunkSize = 2500, pageNum = 0 } = options;

  // Validate input
  if (typeof text !== "string") {
    console.warn(`[chunkTextSimple] Page ${pageNum + 1}: Invalid text type "${typeof text}"`);
    return [];
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    console.log(`[chunkTextSimple] Page ${pageNum + 1}: Empty text`);
    return [];
  }

  if (trimmedText.length < 100) {
    console.log(`[chunkTextSimple] Page ${pageNum + 1}: Text too short (${trimmedText.length} chars)`);
    return [];
  }

  console.log(`[chunkTextSimple] Page ${pageNum + 1}: Processing ${trimmedText.length} chars`);

  // Split into paragraphs
  const paragraphs = trimmedText.split(/\n\s*\n/).filter((p) => p.trim().length > 50);

  if (paragraphs.length === 0) {
    // If no good paragraphs, treat entire text as one chunk
    if (trimmedText.length >= 100) {
      console.log(`[chunkTextSimple] Page ${pageNum + 1}: Using full text as single chunk`);
      return [trimmedText];
    }
    return [];
  }

  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // If adding this paragraph would exceed chunk size, save current chunk
    if (currentChunk.length + trimmed.length > maxChunkSize && currentChunk.length > 200) {
      chunks.push(currentChunk.trim());
      // Keep overlap: last ~200 chars (about 40 words)
      const words = currentChunk.split(" ");
      const overlapText = words.slice(-40).join(" ");
      currentChunk = overlapText + "\n\n" + trimmed + "\n\n";
    } else {
      currentChunk += trimmed + "\n\n";
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 100) {
    chunks.push(currentChunk.trim());
  }

  console.log(`[chunkTextSimple] Page ${pageNum + 1}: Created ${chunks.length} chunks`);
  return chunks;
}

/**
 * Extract text from PDF buffer using unpdf
 */
export async function extractTextByPages(
  pdfBuffer: ArrayBuffer
): Promise<{ pages: string[]; totalPages: number }> {
  console.log(`[extractTextByPages] Starting extraction (${pdfBuffer.byteLength} bytes)`);

  const { extractText } = await import("unpdf");
  const extracted = await extractText(pdfBuffer);

  console.log(`[extractTextByPages] PDF reports ${extracted.totalPages} pages`);

  // Handle different return types from unpdf
  let pages: string[];

  if (Array.isArray(extracted.text)) {
    pages = extracted.text;
  } else if (typeof extracted.text === "string") {
    pages = [extracted.text];
  } else {
    console.warn(`[extractTextByPages] Unexpected type: ${typeof extracted.text}`);
    pages = [String(extracted.text || "")];
  }

  // Validate pages
  const validPages = pages.filter((page, index) => {
    if (typeof page !== "string") {
      console.warn(`[extractTextByPages] Page ${index + 1}: Not a string`);
      return false;
    }
    if (page.trim().length < 50) {
      console.log(`[extractTextByPages] Page ${index + 1}: Too short (${page.length} chars)`);
      return false;
    }
    return true;
  });

  console.log(`[extractTextByPages] ${validPages.length}/${pages.length} pages valid`);

  return {
    pages: validPages,
    totalPages: extracted.totalPages || validPages.length,
  };
}

/**
 * Chunk pages with metadata
 */
export function chunkPagesWithMetadata(
  pages: string[],
  options: {
    maxChunkSize?: number;
  } = {}
): ChunkWithMetadata[] {
  const { maxChunkSize = 2500 } = options;
  const chunks: ChunkWithMetadata[] = [];
  let globalChunkIndex = 0;

  console.log(`[chunkPagesWithMetadata] Processing ${pages.length} pages`);

  for (let pageNum = 0; pageNum < pages.length; pageNum++) {
    const pageText = pages[pageNum];

    // Use simple chunking
    const pageChunks = chunkTextSimple(pageText, {
      maxChunkSize,
      pageNum,
    });

    if (pageChunks.length === 0) {
      console.log(`[chunkPagesWithMetadata] Page ${pageNum + 1}: No chunks`);
      continue;
    }

    // Add metadata
    for (let i = 0; i < pageChunks.length; i++) {
      const chunkText = pageChunks[i];
      const startChar = pageText.indexOf(chunkText);

      if (startChar === -1) {
        console.warn(`[chunkPagesWithMetadata] Page ${pageNum + 1}: Chunk not found in text`);
        continue;
      }

      chunks.push({
        text: chunkText,
        metadata: {
          page: pageNum + 1,
          charRange: [startChar, startChar + chunkText.length],
          totalPages: pages.length,
          chunkIndex: globalChunkIndex++,
        },
      });
    }

    console.log(`[chunkPagesWithMetadata] Page ${pageNum + 1}: ${pageChunks.length} chunks`);
  }

  console.log(`[chunkPagesWithMetadata] Total: ${chunks.length} chunks`);
  return chunks;
}

/**
 * Main extraction function
 */
export async function extractAndChunkPdf(
  pdfBuffer: ArrayBuffer,
  options?: {
    maxChunkSize?: number;
  }
): Promise<ChunkWithMetadata[]> {
  console.log(`[extractAndChunkPdf] Starting (${pdfBuffer.byteLength} bytes)`);

  try {
    const { pages, totalPages } = await extractTextByPages(pdfBuffer);

    if (pages.length === 0) {
      console.warn(`[extractAndChunkPdf] No valid pages`);
      return [];
    }

    const chunks = chunkPagesWithMetadata(pages, options);
    console.log(`[extractAndChunkPdf] Complete: ${chunks.length} chunks`);
    return chunks;
  } catch (error) {
    console.error(`[extractAndChunkPdf] Error: ${error}`);
    throw error;
  }
}

/**
 * Format chunk for display
 */
export function formatChunkWithMetadata(chunk: ChunkWithMetadata): string {
  const { page, charRange, chunkIndex } = chunk.metadata;
  const [start, end] = charRange;
  return `[Page ${page}, chars ${start}-${end}]
${chunk.text}`;
}

/**
 * Prepare for RAG
 */
export function prepareChunksForRag(
  chunks: ChunkWithMetadata[]
): Array<{ text: string; metadata: Record<string, any> }> {
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
