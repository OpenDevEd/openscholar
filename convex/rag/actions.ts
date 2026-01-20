"use node";

/**
 * RAG Actions - PDF processing, text extraction, and vector indexing.
 */
import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { extractText } from "unpdf";
import {
  rag,
  getAnalysisNamespace,
  getDocumentKey,
  chunkText,
  prepareDocumentContent,
} from "./index";
import type { Id } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════
// Configuration Constants
// ═══════════════════════════════════════════════════════════════

const PDF_DOWNLOAD_CONFIG = {
  CONCURRENCY_LIMIT: 3,         // Reduced - Ollama can't handle 10 concurrent embeddings
  FETCH_TIMEOUT_MS: 30000,      // 30s per fetch
  EXTRACTION_TIMEOUT_MS: 30000, // 30s per PDF extraction
  MAX_RETRIES: 1,               // Retry once for 5xx errors
  RETRY_DELAY_MS: 5000,         // 5s between retries
  SKIP_RAG_INDEXING: true,      // Skip RAG to avoid Ollama bottleneck
};

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch with timeout using AbortController.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = PDF_DOWNLOAD_CONFIG.FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Smart PDF fetcher result
 */
interface SmartFetchResult {
  type: "pdf" | "html" | "error" | "skip";
  response?: Response;
  finalUrl?: string;
  pdfUrlFromHtml?: string;
  error?: string;
}

/**
 * Smart fetch that follows redirects and determines content type.
 * Returns enough info to either use the PDF directly or parse HTML.
 */
async function smartFetchForPdf(
  url: string,
  docIndex: number
): Promise<SmartFetchResult> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/pdf,text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    // Do a GET request (not HEAD) to properly follow all redirects
    // Many sites don't handle HEAD properly or return different content-types
    const response = await fetchWithTimeout(url, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      return { type: "error", error: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Get the final URL after redirects
    const finalUrl = response.url || url;
    const contentType = response.headers.get("content-type") || "";
    
    console.log(`[OpenAccess] [${docIndex}] Final URL: ${finalUrl.substring(0, 80)}...`);
    console.log(`[OpenAccess] [${docIndex}] Content-Type: ${contentType}`);

    // Check if it's a PDF by content-type (primary method)
    if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
      // Double-check: if octet-stream, verify it's actually a PDF
      if (contentType.includes("application/octet-stream")) {
        // Clone before consuming and check magic bytes
        const cloned = response.clone();
        const buffer = await cloned.arrayBuffer();
        const header = new Uint8Array(buffer.slice(0, 5));
        const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
        if (!isPdf) {
          console.log(`[OpenAccess] [${docIndex}] octet-stream is not PDF, treating as unknown`);
          return { type: "skip", error: "octet-stream is not a PDF" };
        }
      }
      return { type: "pdf", response, finalUrl };
    }

    // Check if URL looks like a PDF (some servers return wrong content-type)
    if (finalUrl.toLowerCase().includes(".pdf") || 
        finalUrl.toLowerCase().includes("/pdf/") ||
        finalUrl.toLowerCase().includes("pdfdirect")) {
      console.log(`[OpenAccess] [${docIndex}] URL suggests PDF, trying to read...`);
      
      // Read first few bytes to check for PDF magic number
      const cloned = response.clone();
      const buffer = await cloned.arrayBuffer();
      const header = new Uint8Array(buffer.slice(0, 5));
      const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
      
      if (isPdf) {
        console.log(`[OpenAccess] [${docIndex}] Confirmed PDF by magic number`);
        // Create a new response from the buffer since we consumed the original
        const newResponse = new Response(buffer, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        return { type: "pdf", response: newResponse, finalUrl };
      }
    }

    // It's HTML - parse it for PDF links
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const html = await response.text();
      const pdfUrlFromHtml = extractPdfUrlFromHtml(html, finalUrl);
      
      if (pdfUrlFromHtml) {
        return { type: "html", pdfUrlFromHtml, finalUrl };
      } else {
        return { type: "skip", error: "HTML page with no PDF links found" };
      }
    }

    // Unknown content type
    return { type: "skip", error: `Unknown content type: ${contentType}` };

  } catch (e: any) {
    const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
    return { type: "error", error: isTimeout ? "Request timeout" : e.message };
  }
}

/**
 * Fetch PDF with retry logic for transient errors.
 */
async function fetchPdfWithRetry(
  url: string,
  maxRetries: number = PDF_DOWNLOAD_CONFIG.MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/pdf,*/*",
        },
        redirect: "follow",
      });

      // Only retry on transient errors (5xx, 429)
      if (response.status >= 500 || response.status === 429) {
        if (attempt < maxRetries) {
          console.log(`[OpenAccess] Retry ${attempt + 1}/${maxRetries} for ${url.substring(0, 50)}... (${response.status})`);
          await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_CONFIG.RETRY_DELAY_MS));
          continue;
        }
      }

      return response;
    } catch (e: any) {
      lastError = e;
      const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
      
      if (isTimeout && attempt < maxRetries) {
        console.log(`[OpenAccess] Timeout retry ${attempt + 1}/${maxRetries} for ${url.substring(0, 50)}...`);
        await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_CONFIG.RETRY_DELAY_MS));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error("Fetch failed after retries");
}

/**
 * Extract PDF URL from HTML page (check meta tags, embeds, links).
 * Enhanced to find .pdf anywhere in URLs (with query params, etc.)
 */
function extractPdfUrlFromHtml(html: string, baseUrl: string): string | null {
  // Priority 1: citation_pdf_url meta tag (most reliable for academic sites)
  const citationMatch = html.match(/<meta\s+name=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i);
  if (citationMatch) {
    console.log(`[PDF Extract] Found citation_pdf_url: ${citationMatch[1].substring(0, 60)}...`);
    return resolveUrl(citationMatch[1], baseUrl);
  }

  // Priority 2: DC.identifier meta tag with PDF
  const dcMatch = html.match(/<meta\s+name=["']DC\.identifier["']\s+content=["']([^"']*\.pdf[^"']*)["']/i);
  if (dcMatch) {
    console.log(`[PDF Extract] Found DC.identifier: ${dcMatch[1].substring(0, 60)}...`);
    return resolveUrl(dcMatch[1], baseUrl);
  }

  // Priority 3: og:url with PDF
  const ogMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']*\.pdf[^"']*)["']/i);
  if (ogMatch) {
    console.log(`[PDF Extract] Found og:url: ${ogMatch[1].substring(0, 60)}...`);
    return resolveUrl(ogMatch[1], baseUrl);
  }

  // Priority 4: Find ALL anchor tags with .pdf anywhere in href (including query params)
  // Pattern matches .pdf followed by optional query string or end of URL
  const pdfLinkRegex = /href=["']([^"']*\.pdf(?:\?[^"']*)?|[^"']*\.pdf)["']/gi;
  const pdfLinks: string[] = [];
  let match;
  while ((match = pdfLinkRegex.exec(html)) !== null) {
    pdfLinks.push(match[1]);
  }
  
  if (pdfLinks.length > 0) {
    // Prefer links with /bitstream/, /download/, /pdf/ in path (more likely to be actual PDFs)
    const priorityLink = pdfLinks.find(link => 
      /\/(bitstream|download|pdf|fulltext|content)\//i.test(link)
    );
    const selectedLink = priorityLink || pdfLinks[0];
    console.log(`[PDF Extract] Found ${pdfLinks.length} PDF links, using: ${selectedLink.substring(0, 60)}...`);
    return resolveUrl(selectedLink, baseUrl);
  }

  // Priority 5: Try embed or iframe with PDF
  const embedMatch = html.match(/<(?:embed|iframe)[^>]+src=["']([^"']*\.pdf[^"']*)["']/i);
  if (embedMatch) {
    console.log(`[PDF Extract] Found embed/iframe: ${embedMatch[1].substring(0, 60)}...`);
    return resolveUrl(embedMatch[1], baseUrl);
  }

  // Priority 6: Look for data-pdf-url or similar data attributes
  const dataAttrMatch = html.match(/data-(?:pdf|download)-url=["']([^"']+)["']/i);
  if (dataAttrMatch) {
    console.log(`[PDF Extract] Found data attribute: ${dataAttrMatch[1].substring(0, 60)}...`);
    return resolveUrl(dataAttrMatch[1], baseUrl);
  }

  console.log(`[PDF Extract] No PDF links found in HTML`);
  return null;
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Safely extract text from PDF buffer with timeout and proper memory handling.
 */
async function extractTextSafely(
  pdfData: ArrayBuffer,
  timeoutMs: number = PDF_DOWNLOAD_CONFIG.EXTRACTION_TIMEOUT_MS
): Promise<string> {
  // Create a NEW Uint8Array with its own backing buffer to prevent detachment
  const bufferCopy = new Uint8Array(new ArrayBuffer(pdfData.byteLength));
  bufferCopy.set(new Uint8Array(pdfData));

  // Wrap extraction in timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PDF extraction timeout")), timeoutMs);
  });

  const extractPromise = (async () => {
    const result = await extractText(bufferCopy, { mergePages: true });
    return result.text;
  })();

  return Promise.race([extractPromise, timeoutPromise]);
}

/**
 * Process a PDF buffer: extract text, store PDF, save to document.
 * Reusable helper for the open access downloader.
 */
async function processPdfBuffer(
  ctx: ActionCtx,
  doc: {
    _id: Id<"documents">;
    analysisId: Id<"analyses">;
    title: string;
    abstract: string | undefined;
    authors: string[] | undefined;
    year: number | undefined;
  },
  arrayBuffer: ArrayBuffer,
  docIndex: number,
  shortTitle: string
): Promise<void> {
  console.log(`[OpenAccess] [${docIndex}] Downloaded ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`);

  // Extract text using safe wrapper
  console.log(`[OpenAccess] [${docIndex}] Extracting text...`);
  const fullText = await extractTextSafely(arrayBuffer);

  if (!fullText || fullText.trim().length < 100) {
    throw new Error(`Insufficient text extracted (${fullText?.length || 0} chars)`);
  }

  console.log(`[OpenAccess] [${docIndex}] Extracted ${fullText.length} chars`);

  // Store PDF in Convex storage
  const pdfBuffer = new Uint8Array(arrayBuffer);
  const storageId = await ctx.storage.store(
    new Blob([pdfBuffer], { type: "application/pdf" })
  );

  // Update document
  await ctx.runMutation(internal.rag.mutations.savePdfStorageId, {
    documentId: doc._id,
    pdfStorageId: storageId,
  });

  await ctx.runMutation(internal.rag.mutations.saveFullText, {
    documentId: doc._id,
    fullText,
  });

  // Index into RAG (unless skipped due to Ollama bottleneck)
  if (!PDF_DOWNLOAD_CONFIG.SKIP_RAG_INDEXING) {
    await indexDocumentContent(ctx, {
      documentId: doc._id,
      analysisId: doc.analysisId,
      title: doc.title,
      abstract: doc.abstract,
      fullText,
      authors: doc.authors,
      year: doc.year,
    });

    // Update status to ready
    await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
      documentId: doc._id,
      status: "ready",
    });
  } else {
    console.log(`[OpenAccess] [${docIndex}] Skipping RAG indexing (text saved, will batch index later)`);
  }

  console.log(`[OpenAccess] [${docIndex}] SUCCESS: ${shortTitle}... (${fullText.length} chars)`);
}

/**
 * Process a PDF file: extract text and index into RAG.
 */
export const processPdf = action({
  args: {
    documentId: v.id("documents"),
    storageId: v.id("_storage"),
  },
  returns: v.object({
    success: v.boolean(),
    textLength: v.optional(v.number()),
    chunksIndexed: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { documentId, storageId }) => {
    try {
      // Get the document
      const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
        documentId,
      });

      if (!doc) {
        return { success: false, error: "Document not found" };
      }

      // Update status to processing
      await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
        documentId,
        status: "processing",
      });

      // Save PDF storage ID to document
      await ctx.runMutation(internal.rag.mutations.savePdfStorageId, {
        documentId,
        pdfStorageId: storageId,
      });

      // Get PDF from storage
      const pdfBlob = await ctx.storage.get(storageId);
      if (!pdfBlob) {
        await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
          documentId,
          status: "error",
        });
        return { success: false, error: "PDF not found in storage" };
      }

      // Extract text from PDF using unpdf
      const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());
      const { text: fullText } = await extractText(pdfBuffer, { mergePages: true });

      if (!fullText || fullText.trim().length === 0) {
        await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
          documentId,
          status: "error",
        });
        return { success: false, error: "No text extracted from PDF" };
      }

      // Save full text to document
      await ctx.runMutation(internal.rag.mutations.saveFullText, {
        documentId,
        fullText,
      });

      // Index into RAG
      const chunksIndexed = await indexDocumentContent(ctx, {
        documentId: doc._id,
        analysisId: doc.analysisId,
        title: doc.title,
        abstract: doc.abstract,
        fullText,
        authors: doc.authors,
        year: doc.year,
      });

      // Update status to ready
      await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
        documentId,
        status: "ready",
      });

      return {
        success: true,
        textLength: fullText.length,
        chunksIndexed,
      };
    } catch (error: any) {
      console.error("PDF processing error:", error);
      await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
        documentId,
        status: "error",
      });
      return { success: false, error: error.message || "Processing failed" };
    }
  },
});

/**
 * Index a document's content into the RAG system.
 * Called after PDF extraction or for documents with just abstracts.
 */
export const indexDocument = action({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.object({
    success: v.boolean(),
    chunksIndexed: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { documentId }) => {
    try {
      const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
        documentId,
      });

      if (!doc) {
        return { success: false, error: "Document not found" };
      }

      // Check if there's content to index
      if (!doc.abstract && !doc.fullText) {
        return { success: false, error: "No content to index" };
      }

      const chunksIndexed = await indexDocumentContent(ctx, {
        documentId: doc._id,
        analysisId: doc.analysisId,
        title: doc.title,
        abstract: doc.abstract,
        fullText: doc.fullText,
        authors: doc.authors,
        year: doc.year,
      });

      return { success: true, chunksIndexed };
    } catch (error: any) {
      console.error("Indexing error:", error);
      return { success: false, error: error.message || "Indexing failed" };
    }
  },
});

/**
 * Index all documents in an analysis that haven't been indexed yet.
 */
export const indexAnalysisDocuments = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    indexed: v.number(),
    skipped: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, { analysisId }) => {
    const docs = await ctx.runQuery(internal.rag.queries.getUnindexedDocuments, {
      analysisId,
    });

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of docs) {
      // Skip if no content
      if (!doc.abstract && !doc.fullText) {
        skipped++;
        continue;
      }

      try {
        await indexDocumentContent(ctx, {
          documentId: doc._id,
          analysisId: doc.analysisId,
          title: doc.title,
          abstract: doc.abstract,
          fullText: doc.fullText,
          authors: doc.authors,
          year: doc.year,
        });
        indexed++;
      } catch (error) {
        console.error(`Failed to index document ${doc._id}:`, error);
        errors++;
      }
    }

    return { indexed, skipped, errors };
  },
});

/**
 * Search for relevant context from indexed documents.
 */
export const searchContext = action({
  args: {
    analysisId: v.id("analyses"),
    query: v.string(),
    limit: v.optional(v.number()),
    documentId: v.optional(v.id("documents")), // Optional: limit to specific document
  },
  returns: v.object({
    text: v.string(),
    chunks: v.array(
      v.object({
        text: v.string(),
        score: v.number(),
        documentId: v.string(),
        title: v.string(),
      })
    ),
  }),
  handler: async (ctx, { analysisId, query, limit = 5, documentId }) => {
    const namespace = getAnalysisNamespace(analysisId);

    const searchOptions: any = {
      namespace,
      query,
      limit,
      chunkContext: { before: 1, after: 1 }, // Include surrounding chunks
    };

    // Filter to specific document if provided
    if (documentId) {
      searchOptions.filter = { documentId: documentId };
    }

    const { results, text, entries } = await rag.search(ctx, searchOptions);

    // Results contain: score, entryId, content (array of chunks with text), order, startOrder
    // We need to extract text from result.content array
    const chunks = results.map((r: any) => {
      // Combine all chunk texts from this result
      const chunkText = r.content?.map((c: any) => c.text).join("\n") || "";
      
      // Find the matching entry to get metadata
      const entry = entries.find((e: any) => e.entryId === r.entryId);
      
      return {
        text: chunkText,
        score: r.score,
        documentId: entry?.metadata?.documentId || "",
        title: entry?.metadata?.title || entry?.title || "",
      };
    });

    return { text, chunks };
  },
});

/**
 * Helper function to index document content.
 */
async function indexDocumentContent(
  ctx: any,
  doc: {
    documentId: Id<"documents">;
    analysisId: Id<"analyses">;
    title: string;
    abstract?: string;
    fullText?: string;
    authors?: string[];
    year?: number;
  }
): Promise<number> {
  const namespace = getAnalysisNamespace(doc.analysisId);
  const contentKey = getDocumentKey(doc.documentId, "content");

  // Prepare full content
  const content = prepareDocumentContent({
    title: doc.title,
    abstract: doc.abstract,
    fullText: doc.fullText,
    authors: doc.authors,
    year: doc.year,
  });

  // Chunk the content
  const chunks = chunkText(content);

  // Add to RAG with metadata
  const { entryId } = await rag.add(ctx, {
    namespace,
    key: contentKey,
    chunks,
    title: doc.title,
    metadata: {
      documentId: doc.documentId,
      analysisId: doc.analysisId,
      title: doc.title,
      contentType: doc.fullText ? "fulltext" : "abstract",
    },
    filterValues: [
      { name: "analysisId", value: doc.analysisId },
      { name: "documentId", value: doc.documentId },
      { name: "contentType", value: doc.fullText ? "fulltext" : "abstract" },
    ],
  });

  // Update document with RAG entry ID
  await ctx.runMutation(internal.rag.mutations.setRagEntryId, {
    documentId: doc.documentId,
    ragEntryId: entryId,
  });

  return chunks.length;
}

/**
 * Extract metadata from PDF text using simple heuristics.
 * Falls back to filename if no title found.
 */
function extractMetadataFromPdf(text: string, fileName: string): {
  title: string;
  authors?: string[];
  year?: number;
  abstract?: string;
} {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  
  // Try to find title (usually first non-empty line or largest text)
  let title = lines[0] || fileName.replace(/\.pdf$/i, "");
  
  // If title is too long, truncate
  if (title.length > 200) {
    title = title.substring(0, 200) + "...";
  }
  
  // Try to find year (look for 4-digit years in reasonable range)
  let year: number | undefined;
  const yearMatch = text.match(/\b(19[89]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }
  
  // Try to find abstract section
  let abstract: string | undefined;
  const abstractMatch = text.match(/abstract[:\s]*\n?([\s\S]{100,2000}?)(?=\n\s*(?:introduction|keywords|1\.|1\s|background))/i);
  if (abstractMatch) {
    abstract = abstractMatch[1].trim().replace(/\s+/g, " ");
  }
  
  // Authors are hard to extract reliably without AI, skip for now
  
  return { title, year, abstract };
}

/**
 * Upload and process multiple PDFs, creating documents from them.
 * This is the main entry point for PDF uploads.
 */
export const uploadPdfs = action({
  args: {
    analysisId: v.id("analyses"),
    pdfs: v.array(
      v.object({
        storageId: v.id("_storage"),
        fileName: v.string(),
      })
    ),
  },
  returns: v.object({
    success: v.boolean(),
    documentsCreated: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx, { analysisId, pdfs }) => {
    const errors: string[] = [];
    let documentsCreated = 0;

    // First, create a source for this upload batch
    const sourceId = await ctx.runMutation(internal.rag.mutations.createPdfSource, {
      analysisId,
      name: `PDF Upload (${pdfs.length} files)`,
      fileCount: pdfs.length,
    });

    for (const pdf of pdfs) {
      try {
        // Get PDF from storage
        const pdfBlob = await ctx.storage.get(pdf.storageId);
        if (!pdfBlob) {
          errors.push(`${pdf.fileName}: File not found in storage`);
          continue;
        }

        // Extract text from PDF
        const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());
        const { text: fullText } = await extractText(pdfBuffer, { mergePages: true });

        if (!fullText || fullText.trim().length < 50) {
          errors.push(`${pdf.fileName}: Could not extract enough text`);
          continue;
        }

        // Extract metadata from the text
        const metadata = extractMetadataFromPdf(fullText, pdf.fileName);

        // Create the document
        const documentId = await ctx.runMutation(internal.rag.mutations.createDocumentFromPdf, {
          analysisId,
          sourceId,
          storageId: pdf.storageId,
          fileName: pdf.fileName,
          title: metadata.title,
          abstract: metadata.abstract,
          authors: metadata.authors,
          year: metadata.year,
          fullText,
        });

        // Index into RAG
        await indexDocumentContent(ctx, {
          documentId,
          analysisId,
          title: metadata.title,
          abstract: metadata.abstract,
          fullText,
          authors: metadata.authors,
          year: metadata.year,
        });

        documentsCreated++;
      } catch (error: any) {
        console.error(`Failed to process ${pdf.fileName}:`, error);
        errors.push(`${pdf.fileName}: ${error.message || "Processing failed"}`);
      }
    }

    // Update source status
    await ctx.runMutation(internal.rag.mutations.updateSourceStatus, {
      sourceId,
      status: errors.length === pdfs.length ? "error" : "ready",
      documentCount: documentsCreated,
    });

    return {
      success: documentsCreated > 0,
      documentsCreated,
      errors,
    };
  },
});

/**
 * Process a single open access PDF (parallel worker).
 * Claims a worker slot, processes one document, then schedules itself for the next.
 */
export const processNextOpenAccessPdf = internalAction({
  args: {
    jobId: v.id("pdfDownloadJobs"),
    analysisId: v.id("analyses"),
  },
  handler: async (ctx, { jobId, analysisId }) => {
    // Try to claim a worker slot
    const claim = await ctx.runMutation(internal.rag.mutations.claimWorkerSlot, { jobId });

    // No more work or job complete
    if (!claim) {
      console.log(`[OpenAccess] Worker exiting - no more work or job complete`);
      return;
    }

    // At capacity, try again later
    if (!claim.canContinue) {
      await ctx.scheduler.runAfter(100, internal.rag.actions.processNextOpenAccessPdf, {
        jobId,
        analysisId,
      });
      return;
    }

    const docIndex = claim.index;
    let success = false;
    let skipped = false;
    let error: string | undefined;

    try {
      // Get the document at this index
      const doc = await ctx.runQuery(internal.rag.queries.getNextDocumentForJob, {
        analysisId,
        offset: docIndex,
      });

      if (!doc || !doc.openAccessUrl) {
        console.log(`[OpenAccess] [${docIndex}] No document found at index, skipping`);
        skipped = true;
      } else {
        const shortTitle = doc.title.substring(0, 40);
        const url = doc.openAccessUrl;
        console.log(`[OpenAccess] [${docIndex}] Processing: ${shortTitle}...`);
        console.log(`[OpenAccess] [${docIndex}] URL: ${url}`);

        try {
          // Step 1: Smart fetch - detects PDF vs HTML, follows redirects
          const smartResult = await smartFetchForPdf(url, docIndex);
          
          if (smartResult.type === "error") {
            throw new Error(smartResult.error || "Unknown fetch error");
          }
          
          if (smartResult.type === "skip") {
            console.log(`[OpenAccess] [${docIndex}] Skipping: ${smartResult.error}`);
            skipped = true;
          } else if (smartResult.type === "html" && smartResult.pdfUrlFromHtml) {
            // Found PDF link in HTML, need to fetch it
            console.log(`[OpenAccess] [${docIndex}] Found PDF link in HTML: ${smartResult.pdfUrlFromHtml.substring(0, 60)}...`);
            
            const pdfResponse = await fetchPdfWithRetry(smartResult.pdfUrlFromHtml);
            
            if (!pdfResponse.ok) {
              throw new Error(`HTTP ${pdfResponse.status}: ${pdfResponse.statusText}`);
            }
            
            // Verify it's actually a PDF
            const pdfContentType = pdfResponse.headers.get("content-type") || "";
            if (pdfContentType.includes("html")) {
              // Second-level HTML - try to parse it too
              console.log(`[OpenAccess] [${docIndex}] Got HTML from PDF link, trying to parse...`);
              const html2 = await pdfResponse.text();
              const pdfUrl2 = extractPdfUrlFromHtml(html2, smartResult.pdfUrlFromHtml);
              
              if (pdfUrl2) {
                console.log(`[OpenAccess] [${docIndex}] Found second-level PDF link: ${pdfUrl2.substring(0, 60)}...`);
                const pdfResponse2 = await fetchPdfWithRetry(pdfUrl2);
                
                if (!pdfResponse2.ok) {
                  throw new Error(`HTTP ${pdfResponse2.status}: ${pdfResponse2.statusText}`);
                }
                
                const pdfContentType2 = pdfResponse2.headers.get("content-type") || "";
                if (pdfContentType2.includes("html")) {
                  console.log(`[OpenAccess] [${docIndex}] Still got HTML, skipping`);
                  skipped = true;
                } else {
                  const arrayBuffer = await pdfResponse2.arrayBuffer();
                  await processPdfBuffer(ctx, doc, arrayBuffer, docIndex, shortTitle);
                  success = true;
                }
              } else {
                console.log(`[OpenAccess] [${docIndex}] No PDF link in second-level HTML, skipping`);
                skipped = true;
              }
            } else {
              // Got PDF directly
              const arrayBuffer = await pdfResponse.arrayBuffer();
              await processPdfBuffer(ctx, doc, arrayBuffer, docIndex, shortTitle);
              success = true;
            }
          } else if (smartResult.type === "pdf" && smartResult.response) {
            // Got PDF directly from the first request
            console.log(`[OpenAccess] [${docIndex}] Got PDF directly from URL`);
            const arrayBuffer = await smartResult.response.arrayBuffer();
            await processPdfBuffer(ctx, doc, arrayBuffer, docIndex, shortTitle);
            success = true;
          }
        } catch (e: any) {
          error = `${shortTitle}...: ${e.message || "Unknown error"}`;
          console.error(`[OpenAccess] [${docIndex}] FAILED: ${error}`);
        }
      }
    } catch (e: any) {
      error = `Worker error at index ${docIndex}: ${e.message}`;
      console.error(`[OpenAccess] Worker error:`, error);
    }

    // Release worker slot and record result
    try {
      const result = await ctx.runMutation(internal.rag.mutations.releaseWorkerSlot, {
        jobId,
        success,
        skipped,
        error,
      });

      console.log(`[OpenAccess] Progress: ${result.processed}/${result.total} (${result.activeWorkers} workers active)`);

      // If job is not complete, schedule another run
      if (!result.isComplete) {
        await ctx.scheduler.runAfter(0, internal.rag.actions.processNextOpenAccessPdf, {
          jobId,
          analysisId,
        });
      } else {
        console.log(`[OpenAccess] JOB COMPLETE: ${result.processed}/${result.total}`);
      }
    } catch (e: any) {
      console.error(`[OpenAccess] Failed to release worker slot:`, e);
    }
  },
});

/**
 * Download and process open access PDFs for documents that have URLs.
 * This starts a background job with parallel workers and returns immediately.
 */
export const downloadOpenAccessPdfs = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    jobId: v.id("pdfDownloadJobs"),
    totalDocuments: v.number(),
  }),
  handler: async (ctx, { analysisId }): Promise<{ jobId: Id<"pdfDownloadJobs">; totalDocuments: number }> => {
    // Get documents with open access URLs that haven't been processed yet
    const docs = await ctx.runQuery(internal.rag.queries.getDocumentsWithOpenAccessUrls, {
      analysisId,
      limit: 500, // Get all eligible documents
    });

    const concurrency = PDF_DOWNLOAD_CONFIG.CONCURRENCY_LIMIT;

    if (docs.length === 0) {
      // Create a completed job with 0 documents
      const jobId = await ctx.runMutation(internal.rag.mutations.createPdfDownloadJob, {
        analysisId,
        totalDocuments: 0,
        concurrencyLimit: concurrency,
      });
      return { jobId, totalDocuments: 0 };
    }

    console.log(`[OpenAccess] Starting job for ${docs.length} documents with ${concurrency} parallel workers`);

    // Create the job record
    const jobId = await ctx.runMutation(internal.rag.mutations.createPdfDownloadJob, {
      analysisId,
      totalDocuments: docs.length,
      concurrencyLimit: concurrency,
    });

    // Spawn initial workers (up to concurrency limit or total documents)
    const initialWorkers = Math.min(concurrency, docs.length);
    console.log(`[OpenAccess] Spawning ${initialWorkers} initial workers`);
    
    for (let i = 0; i < initialWorkers; i++) {
      await ctx.scheduler.runAfter(i * 50, internal.rag.actions.processNextOpenAccessPdf, {
        jobId,
        analysisId,
      });
    }

    return { jobId, totalDocuments: docs.length };
  },
});
