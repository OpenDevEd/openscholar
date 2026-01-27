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
  CONCURRENCY_LIMIT: 5,          // Parallel workers for PDF download (low to prevent OOM)
  FETCH_TIMEOUT_MS: 30000,      // 30s per fetch
  EXTRACTION_TIMEOUT_MS: 30000, // 30s per PDF extraction
  MAX_RETRIES: 1,               // Retry once for 5xx errors
  RETRY_DELAY_MS: 5000,         // 5s between retries
  SKIP_RAG_INDEXING: true,      // Skip RAG to avoid Ollama bottleneck
};

const INDEXING_CONFIG = {
  CONCURRENCY_LIMIT: 10,         // Parallel workers for RAG indexing (moderate - embedding bound)
};

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Convert PMC/NCBI URLs to EuropePMC direct PDF URLs.
 * PMC uses JS proof-of-work challenge that can't be bypassed with HTTP.
 * EuropePMC serves the same PDFs without anti-bot protection.
 */
function convertToEuropePmcUrl(url: string): string | null {
  // Match patterns like:
  // https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7463275
  // https://www.ncbi.nlm.nih.gov/pmc/articles/7463275
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC7463275/
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC7463275/pdf/main.pdf
  const pmcMatch = url.match(/(?:ncbi\.nlm\.nih\.gov\/pmc|pmc\.ncbi\.nlm\.nih\.gov)\/articles\/(?:PMC)?(\d+)/i);
  if (pmcMatch) {
    const pmcId = pmcMatch[1];
    return `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcId}&blobtype=pdf`;
  }
  return null;
}

/**
 * Extract DOI from a URL if present.
 * Handles doi.org URLs and Zenodo record URLs.
 */
function extractDoiFromUrl(url: string): string | null {
  // Match doi.org URLs: https://doi.org/10.1234/something
  const doiOrgMatch = url.match(/doi\.org\/(10\.[^/\s]+\/[^\s]+)/i);
  if (doiOrgMatch) {
    return doiOrgMatch[1];
  }
  
  // Match Zenodo: https://zenodo.org/records/12345 -> 10.5281/zenodo.12345
  const zenodoMatch = url.match(/zenodo\.org\/records?\/(\d+)/i);
  if (zenodoMatch) {
    return `10.5281/zenodo.${zenodoMatch[1]}`;
  }
  
  return null;
}

/**
 * Fetch alternative OA URLs from multiple sources (OpenAlex + Unpaywall).
 * Returns array of PDF URLs from different locations, prioritizing repositories.
 */
async function fetchAlternativeOaUrls(doi: string | undefined): Promise<string[]> {
  if (!doi) return [];
  
  // Clean DOI - remove URL prefix if present
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '');
  const pdfUrls: Set<string> = new Set();
  
  // Fetch from OpenAlex
  try {
    const response = await fetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=locations`,
      {
        headers: {
          "User-Agent": "OpenCode-PDFFetcher/1.0 (mailto:support@example.com)",
        },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      const locations = data.locations || [];
      
      for (const loc of locations) {
        if (loc.pdf_url && typeof loc.pdf_url === 'string') {
          pdfUrls.add(loc.pdf_url);
        }
      }
    }
  } catch (e) {
    console.log(`[OpenAccess] OpenAlex lookup failed: ${e}`);
  }
  
  // Fetch from Unpaywall (free API, often has different sources)
  try {
    const response = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=opencode-pdf-fetcher@example.org`,
      {
        headers: {
          "User-Agent": "OpenCode-PDFFetcher/1.0",
        },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      
      // Add best OA location
      if (data.best_oa_location?.url_for_pdf) {
        pdfUrls.add(data.best_oa_location.url_for_pdf);
      }
      
      // Add all OA locations (both PDF URLs and landing pages for PMC)
      for (const loc of (data.oa_locations || [])) {
        if (loc.url_for_pdf && typeof loc.url_for_pdf === 'string') {
          pdfUrls.add(loc.url_for_pdf);
        }
        // Also capture landing pages - especially useful for PMC which can be converted
        if (loc.url_for_landing_page && typeof loc.url_for_landing_page === 'string') {
          const landingUrl = loc.url_for_landing_page;
          // Convert PMC/NCBI landing pages to EuropePMC direct PDF URLs
          const europePmcUrl = convertToEuropePmcUrl(landingUrl);
          if (europePmcUrl) {
            pdfUrls.add(europePmcUrl);
          } else if (landingUrl.includes('.pdf') || landingUrl.includes('/pdf/')) {
            // Some landing pages are actually direct PDF links
            pdfUrls.add(landingUrl);
          }
        }
      }
    }
  } catch (e) {
    console.log(`[OpenAccess] Unpaywall lookup failed: ${e}`);
  }
  
  // Convert to array and prioritize repositories
  const urlArray = Array.from(pdfUrls);
  
  const repositoryPatterns = [
    /europepmc\.org/i,
    /arxiv\.org/i,
    /\.edu\//i,
    /repository/i,
    /\.ac\./i,
    /zenodo\.org/i,
    /figshare\.com/i,
    /researchgate\.net/i,
    /ora\.ox\.ac\.uk/i,
    /eprints/i,
    /hal\.science/i,
    /biorxiv\.org/i,
    /medrxiv\.org/i,
  ];
  
  const isRepository = (url: string) => repositoryPatterns.some(p => p.test(url));
  
  // Sort: repositories first
  urlArray.sort((a, b) => {
    const aIsRepo = isRepository(a);
    const bIsRepo = isRepository(b);
    if (aIsRepo && !bIsRepo) return -1;
    if (!aIsRepo && bIsRepo) return 1;
    return 0;
  });
  
  console.log(`[OpenAccess] Found ${urlArray.length} alternative URLs for DOI ${cleanDoi}`);
  return urlArray;
}

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

  // Check if this is a PMC URL - use EuropePMC instead (bypasses PoW challenge)
  const europePmcUrl = convertToEuropePmcUrl(url);
  if (europePmcUrl) {
    console.log(`[OpenAccess] [${docIndex}] PMC detected, trying EuropePMC: ${europePmcUrl.substring(0, 60)}...`);
    try {
      const euroResponse = await fetchWithTimeout(europePmcUrl, { headers, redirect: "follow" });
      if (euroResponse.ok) {
        const contentType = euroResponse.headers.get("content-type") || "";
        if (contentType.includes("application/pdf")) {
          console.log(`[OpenAccess] [${docIndex}] EuropePMC returned PDF directly`);
          return { type: "pdf", response: euroResponse, finalUrl: europePmcUrl };
        }
      }
      console.log(`[OpenAccess] [${docIndex}] EuropePMC failed (${euroResponse.status}), falling back to original URL`);
    } catch (e: any) {
      console.log(`[OpenAccess] [${docIndex}] EuropePMC error: ${e.message}, falling back to original URL`);
    }
  }

  try {
    // Do a GET request (not HEAD) to properly follow all redirects
    // Many sites don't handle HEAD properly or return different content-types
    const response = await fetchWithTimeout(url, {
      headers,
      redirect: "follow",
    });

    // Check for Cloudflare bot protection (403 + cf-mitigated header)
    const cfMitigated = response.headers.get("cf-mitigated");
    if (response.status === 403 && cfMitigated) {
      console.log(`[OpenAccess] [${docIndex}] Cloudflare protection detected (${cfMitigated}), skipping`);
      return { type: "skip", error: "Cloudflare bot protection - requires browser" };
    }

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
  maxRetries: number = PDF_DOWNLOAD_CONFIG.MAX_RETRIES,
  referer?: string
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/pdf,*/*",
          ...(referer && { "Referer": referer }),
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
  // Early detection: PMC/NCBI "Preparing to download" PoW challenge page
  // This page requires JavaScript to solve a proof-of-work challenge
  if (html.includes('<title>Preparing to download') || html.includes('POW_CHALLENGE')) {
    console.log(`[PDF Extract] Detected PMC proof-of-work challenge page, cannot bypass`);
    return null;
  }

  // Priority 0: Check citation_pdf_url first - most reliable source
  // Handles both quoted and unquoted attributes
  const metaTags = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/(?:name|property)=["']?([^"'\s>]+)["']?/i);
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    
    if (nameMatch && contentMatch) {
      const name = nameMatch[1].toLowerCase();
      const content = contentMatch[1];
      
      if (name === 'citation_pdf_url') {
        console.log(`[PDF Extract] Found citation_pdf_url: ${content.substring(0, 60)}...`);
        return resolveUrl(content, baseUrl);
      }
    }
  }

  // Priority 1: Check for meta refresh redirect (client-side redirect)
  // Handles both: url=http://... and url='http://...' (inner quotes)
  const metaRefreshMatch = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=(['"]?)([^"'>\s]+)\1["']?/i) ||
                           html.match(/<meta[^>]+content=["']?\d+;\s*url=(['"]?)([^"'>\s]+)\1["']?[^>]+http-equiv=["']?refresh["']?/i);
  if (metaRefreshMatch) {
    let redirectUrl = metaRefreshMatch[2];
    // Decode HTML entities
    redirectUrl = redirectUrl.replace(/&amp;/g, '&');
    console.log(`[PDF Extract] Found meta refresh redirect: ${redirectUrl.substring(0, 60)}...`);
    return resolveUrl(redirectUrl, baseUrl);
  }

  // Priority 2: Check for window.location redirect in scripts
  // Only use if it looks like a PDF/file URL, not a navigation redirect
  const locationMatches = html.matchAll(/(?:window|self)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi);
  for (const match of locationMatches) {
    const redirectUrl = match[1];
    // Only use if it looks like a file/PDF URL
    if (redirectUrl.includes('.pdf') || redirectUrl.includes('/files/') || 
        redirectUrl.includes('/download') || redirectUrl.includes('/bitstream')) {
      console.log(`[PDF Extract] Found window.location PDF redirect: ${redirectUrl.substring(0, 60)}...`);
      return resolveUrl(redirectUrl, baseUrl);
    }
  }

  // Priority 3: Other meta tags (DC.identifier, og:url with .pdf)
  for (const tag of metaTags) {
    const nameMatch = tag.match(/(?:name|property)=["']?([^"'\s>]+)["']?/i);
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    
    if (nameMatch && contentMatch) {
      const name = nameMatch[1].toLowerCase();
      const content = contentMatch[1];
      
      if (name === 'dc.identifier' && content.toLowerCase().includes('.pdf')) {
        console.log(`[PDF Extract] Found DC.identifier: ${content.substring(0, 60)}...`);
        return resolveUrl(content, baseUrl);
      }
      if (name === 'og:url' && content.toLowerCase().includes('.pdf')) {
        console.log(`[PDF Extract] Found og:url: ${content.substring(0, 60)}...`);
        return resolveUrl(content, baseUrl);
      }
    }
  }

  // Priority 2: Check <link rel="alternate" type="application/pdf">
  const linkTags = html.match(/<link[^>]+>/gi) || [];
  for (const tag of linkTags) {
    const relMatch = tag.match(/rel=["']([^"']+)["']/i);
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    
    if (typeMatch && typeMatch[1].toLowerCase() === 'application/pdf' && hrefMatch) {
       console.log(`[PDF Extract] Found link alternate pdf: ${hrefMatch[1].substring(0, 60)}...`);
       return resolveUrl(hrefMatch[1], baseUrl);
    }
  }

  // Priority 3: Find ALL anchor tags with .pdf in href
  const anchorTags = html.match(/<a[^>]+>/gi) || [];
  const pdfLinks: string[] = [];
  for (const tag of anchorTags) {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      const href = hrefMatch[1];
      if (href.toLowerCase().includes('.pdf')) {
        pdfLinks.push(href);
      }
    }
  }
  
  if (pdfLinks.length > 0) {
    const priorityLink = pdfLinks.find(link => 
      /\/(bitstream|download|pdf|fulltext|content)\//i.test(link)
    );
    const selectedLink = priorityLink || pdfLinks[0];
    console.log(`[PDF Extract] Found ${pdfLinks.length} PDF links, using: ${selectedLink.substring(0, 60)}...`);
    return resolveUrl(selectedLink, baseUrl);
  }

  // Priority 4: Heuristic text matching (Download PDF buttons)
  // Match <a> tags and check their text content
  const linkContentRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkContentRegex.exec(html)) !== null) {
    const href = match[1];
    const content = match[2];
    
    // Check if text suggests PDF download
    if (/(?:Download|View|Full\s*Text|Get).*?PDF|PDF.*?Download/i.test(content) || 
        />\s*PDF\s*</i.test(content) ||
        /class=["'].*?pdf.*?["']/i.test(match[0])) {
       
       if (!href.startsWith("javascript:") && !href.startsWith("#") && !href.startsWith("mailto:")) {
          console.log(`[PDF Extract] Found heuristic PDF link: ${href.substring(0, 60)}...`);
          return resolveUrl(href, baseUrl);
       }
    }
  }

  // Priority 5: Iframe/Embed/Object with PDF src
  const embedMatch = html.match(/<(?:embed|iframe|object)[^>]+(?:src|data)=["']([^"']*\.pdf[^"']*)["']/i);
  if (embedMatch) {
    console.log(`[PDF Extract] Found embed/iframe: ${embedMatch[1].substring(0, 60)}...`);
    return resolveUrl(embedMatch[1], baseUrl);
  }

  // Priority 6: Data attributes
  const dataAttrMatch = html.match(/data-(?:pdf|download)-url=["']([^"']+)["']/i);
  if (dataAttrMatch) {
    console.log(`[PDF Extract] Found data attribute: ${dataAttrMatch[1].substring(0, 60)}...`);
    return resolveUrl(dataAttrMatch[1], baseUrl);
  }

  // Priority 7: Window.open in onclick
  const onclickMatch = html.match(/onclick=["']window\.open\(["']([^"']+\.pdf)["']\)/i);
  if (onclickMatch) {
     console.log(`[PDF Extract] Found onclick PDF: ${onclickMatch[1].substring(0, 60)}...`);
     return resolveUrl(onclickMatch[1], baseUrl);
  }

  // Detect known JS-only sites and log appropriately
  if (html.includes('sciencedirect.com') || html.includes('elsevier.com')) {
    console.log(`[PDF Extract] ScienceDirect/Elsevier page requires JavaScript - no direct PDF link available`);
  } else if (html.includes('springer.com') && html.includes('access="No"')) {
    console.log(`[PDF Extract] Springer page indicates no access (paywall)`);
  } else {
    console.log(`[PDF Extract] No PDF links found in HTML`);
    // Debug: log first 500 chars of HTML to help diagnose issues
    console.log(`[PDF Extract] HTML preview: ${html.substring(0, 500).replace(/\s+/g, ' ')}...`);
  }
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
 * Page boundary info for citation tracking.
 */
interface PageBoundary {
  pageNumber: number;
  startChar: number;
  endChar: number;
}

/**
 * Result of page-aware PDF text extraction.
 */
interface ExtractedPdfWithPages {
  fullText: string;
  pages: PageBoundary[];
}

/**
 * Safely extract text from PDF buffer with page boundaries.
 * Returns both the full text and page boundary info for citation tracking.
 */
async function extractTextWithPages(
  pdfData: ArrayBuffer,
  timeoutMs: number = PDF_DOWNLOAD_CONFIG.EXTRACTION_TIMEOUT_MS
): Promise<ExtractedPdfWithPages> {
  // Create a NEW Uint8Array with its own backing buffer to prevent detachment
  const bufferCopy = new Uint8Array(new ArrayBuffer(pdfData.byteLength));
  bufferCopy.set(new Uint8Array(pdfData));

  // Wrap extraction in timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PDF extraction timeout")), timeoutMs);
  });

  const extractPromise = (async () => {
    // Extract with mergePages: false to get individual page text
    // Returns { totalPages: number, text: string[] }
    const result = await extractText(bufferCopy, { mergePages: false });

    const pages: PageBoundary[] = [];
    let currentChar = 0;

    // text is an array of strings when mergePages: false
    const pageTexts = result.text as string[];
    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      pages.push({
        pageNumber: i + 1,
        startChar: currentChar,
        endChar: currentChar + pageText.length,
      });
      currentChar += pageText.length + 1; // +1 for newline separator
    }

    // Join with newlines to create full text
    const fullText = pageTexts.join("\n");

    return { fullText, pages };
  })();

  return Promise.race([extractPromise, timeoutPromise]);
}

/**
 * Process a PDF buffer: extract text with page boundaries, store PDF, save to document.
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

  // Extract text with page boundaries for citation tracking
  console.log(`[OpenAccess] [${docIndex}] Extracting text with page boundaries...`);
  const { fullText, pages } = await extractTextWithPages(arrayBuffer);

  if (!fullText || fullText.trim().length < 100) {
    throw new Error(`Insufficient text extracted (${fullText?.length || 0} chars)`);
  }

  console.log(`[OpenAccess] [${docIndex}] Extracted ${fullText.length} chars across ${pages.length} pages`);

  // Store PDF in Convex storage
  const pdfBuffer = new Uint8Array(arrayBuffer);
  const storageId = await ctx.storage.store(
    new Blob([pdfBuffer], { type: "application/pdf" })
  );

  // Save PDF with page boundaries
  await ctx.runMutation(internal.rag.mutations.savePdfWithPages, {
    documentId: doc._id,
    pdfStorageId: storageId,
    fullText,
    pdfPages: pages,
  });

  // Index into RAG (unless skipped due to Ollama bottleneck)
  if (!PDF_DOWNLOAD_CONFIG.SKIP_RAG_INDEXING) {
    await indexDocumentContent(ctx, {
      documentId: doc._id,
      analysisId: doc.analysisId,
      title: doc.title,
      abstract: doc.abstract,
      fullText,
      pdfPages: pages,
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

  console.log(`[OpenAccess] [${docIndex}] SUCCESS: ${shortTitle}... (${fullText.length} chars, ${pages.length} pages)`);
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
 * Search for relevant context from indexed documents.
 * Returns chunks with position info for citation tracking.
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
        // Position info for citations
        sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
        pageNumber: v.optional(v.number()),
        startChar: v.number(),
        endChar: v.number(),
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

    // REMOVED: docCache that loaded fullText into memory for every search
    // Position info is now derived from RAG metadata stored during indexing

    // Results contain: score, entryId, content (array of chunks with text), order, startOrder
    const chunks = await Promise.all(
      results.map(async (r: any) => {
        // Combine all chunk texts from this result
        const chunkText = r.content?.map((c: any) => c.text).join("\n") || "";

        // Find the matching entry to get metadata
        const entry = entries.find((e: any) => e.entryId === r.entryId);
        const docId = entry?.metadata?.documentId || "";
        const metadata = (entry?.metadata || {}) as {
          contentType?: string;
          pageNumber?: number | null;
          startChar?: number;
          endChar?: number;
          title?: string;
        };

        // Use metadata stored during indexing for position info
        // This avoids loading fullText (100-500KB) for every search
        const sourceType: "abstract" | "pdf" = metadata.contentType === "fulltext" ? "pdf" : "abstract";
        const pageNumber = metadata.pageNumber ?? undefined;
        
        // For character positions, use metadata if available, otherwise estimate from chunk
        const startChar = metadata.startChar ?? 0;
        const endChar = metadata.endChar ?? chunkText.length;

        return {
          text: chunkText,
          score: r.score,
          documentId: docId,
          title: metadata.title || entry?.title || "",
          sourceType,
          pageNumber,
          startChar,
          endChar,
        };
      })
    );

    return { text, chunks };
  },
});

/**
 * Helper function to index document content with position tracking.
 */
async function indexDocumentContent(
  ctx: any,
  doc: {
    documentId: Id<"documents">;
    analysisId: Id<"analyses">;
    title: string;
    abstract?: string;
    fullText?: string;
    pdfPages?: { pageNumber: number; startChar: number; endChar: number }[];
    authors?: string[];
    year?: number;
  }
): Promise<number> {
  const namespace = getAnalysisNamespace(doc.analysisId);
  const contentKey = getDocumentKey(doc.documentId, "content");

  // Prepare full content (for legacy combined text)
  const content = prepareDocumentContent({
    title: doc.title,
    abstract: doc.abstract,
    fullText: doc.fullText,
    authors: doc.authors,
    year: doc.year,
  });

  // Chunk the content
  const chunks = chunkText(content);

  // Add to RAG with metadata (position info stored in metadata for later retrieval)
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

// ═══════════════════════════════════════════════════════════════
// DATA CLEARING - For development/testing only
// ═══════════════════════════════════════════════════════════════

/**
 * Clear all extraction-related data. Loops until all data is cleared.
 */
export const clearAllExtractionData = action({
  args: {},
  returns: v.object({
    extractionResults: v.number(),
    jobs: v.number(),
    jobItems: v.number(),
    documentsReset: v.number(),
  }),
  handler: async (ctx) => {
    let totalResults = 0;
    let totalJobs = 0;
    let totalJobItems = 0;
    let totalDocsReset = 0;
    let hasMore = true;
    let iterations = 0;
    const maxIterations = 100; // Safety limit

    console.log("[Clear] Starting extraction data cleanup...");

    while (hasMore && iterations < maxIterations) {
      const result = await ctx.runMutation(internal.rag.mutations.clearExtractionDataBatch, {
        batchSize: 50,
      });

      totalResults += result.extractionResults;
      totalJobs += result.jobs;
      totalJobItems += result.jobItems;
      totalDocsReset += result.documentsReset;
      hasMore = result.hasMore;
      iterations++;

      if (iterations % 10 === 0) {
        console.log(`[Clear] Iteration ${iterations}: ${totalResults} results, ${totalDocsReset} docs reset`);
      }
    }

    console.log(`[Clear] Complete after ${iterations} iterations:`);
    console.log(`  - Extraction results: ${totalResults}`);
    console.log(`  - Jobs: ${totalJobs}`);
    console.log(`  - Job items: ${totalJobItems}`);
    console.log(`  - Documents reset: ${totalDocsReset}`);

    return {
      extractionResults: totalResults,
      jobs: totalJobs,
      jobItems: totalJobItems,
      documentsReset: totalDocsReset,
    };
  },
});

/**
 * NUCLEAR OPTION: Delete ALL analysis data from the database.
 * This removes: analyses, analysisSources, documents, extractionResults,
 * jobs, jobItems, and storage files.
 */
export const nukeAllData = action({
  args: {},
  returns: v.object({
    extractionResults: v.number(),
    documents: v.number(),
    analysisSources: v.number(),
    analyses: v.number(),
    jobs: v.number(),
    jobItems: v.number(),
    storageFiles: v.number(),
  }),
  handler: async (ctx) => {
    const totals = {
      extractionResults: 0,
      documents: 0,
      analysisSources: 0,
      analyses: 0,
      jobs: 0,
      jobItems: 0,
      storageFiles: 0,
    };
    let hasMore = true;
    let iterations = 0;
    const maxIterations = 200; // Safety limit

    console.log("[NUKE] Starting complete database wipe...");

    while (hasMore && iterations < maxIterations) {
      const result = await ctx.runMutation(internal.rag.mutations.nukeAllDataBatch, {
        batchSize: 50,
      });

      totals.extractionResults += result.deleted.extractionResults;
      totals.documents += result.deleted.documents;
      totals.analysisSources += result.deleted.analysisSources;
      totals.analyses += result.deleted.analyses;
      totals.jobs += result.deleted.jobs;
      totals.jobItems += result.deleted.jobItems;
      totals.storageFiles += result.deleted.storageFiles;
      hasMore = result.hasMore;
      iterations++;

      if (iterations % 5 === 0) {
        console.log(`[NUKE] Iteration ${iterations}: ${totals.documents} docs, ${totals.analyses} analyses deleted`);
      }
    }

    console.log(`[NUKE] Complete after ${iterations} iterations:`);
    console.log(`  - Analyses: ${totals.analyses}`);
    console.log(`  - Analysis Sources: ${totals.analysisSources}`);
    console.log(`  - Documents: ${totals.documents}`);
    console.log(`  - Extraction Results: ${totals.extractionResults}`);
    console.log(`  - Jobs: ${totals.jobs}`);
    console.log(`  - Job Items: ${totals.jobItems}`);
    console.log(`  - Storage Files: ${totals.storageFiles}`);

    return totals;
  },
});

// ═══════════════════════════════════════════════════════════════
// RAG CLEANUP ACTION - Called by cron job
// ═══════════════════════════════════════════════════════════════

/**
 * Scheduled cleanup of old replaced RAG entries.
 * Self-scheduling: continues until all old entries are deleted.
 */
export const cleanupOldRagEntriesAction = internalAction({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { cursor }): Promise<null> => {
    const result = await ctx.runMutation(internal.rag.mutations.cleanupOldRagEntries, {
      cursor,
    });

    if (result.deleted > 0) {
      console.log(`[RAG Cleanup] Deleted ${result.deleted} old entries`);
    }

    // Continue if there's more to delete
    if (result.hasMore && result.nextCursor) {
      await ctx.scheduler.runAfter(0, internal.rag.actions.cleanupOldRagEntriesAction, {
        cursor: result.nextCursor,
      });
    } else if (result.deleted > 0) {
      console.log("[RAG Cleanup] Complete");
    }

    return null;
  },
});
