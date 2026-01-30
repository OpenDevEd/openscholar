/**
 * PDF Download Utility
 * 
 * Downloads PDFs from URLs with smart URL extraction from HTML.
 * Enhanced with PMC bypass, alternative OA sources, and bot detection.
 * No text extraction, no database operations - just raw PDF bytes.
 */

const PDF_DOWNLOAD_CONFIG = {
  FETCH_TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 5000,
};

export interface DownloadPdfOptions {
  timeout?: number;
  maxRetries?: number;
  zoteroConnection?: {
    apiKey: string;
    userId: string;
  };
  doi?: string; // For fetching alternative OA URLs
}

export interface DownloadPdfResult {
  success: boolean;
  pdfData?: ArrayBuffer;
  error?: string;
  source?: 'direct' | 'pmc-conversion' | 'alternative-oa' | 'html-extraction';
}

/**
 * Download PDF from URL with retry logic and smart URL extraction
 */
export async function downloadPdf(
  url: string,
  options: DownloadPdfOptions = {}
): Promise<DownloadPdfResult> {
  const timeout = options.timeout || PDF_DOWNLOAD_CONFIG.FETCH_TIMEOUT_MS;
  const maxRetries = options.maxRetries || PDF_DOWNLOAD_CONFIG.MAX_RETRIES;

  try {
    // Handle Zotero attachments
    if (url.startsWith("zotero://") && options.zoteroConnection) {
      return await downloadZoteroPdf(url, options.zoteroConnection, timeout, maxRetries);
    }

    // Try PMC/EuropePMC conversion first (bypasses PoW challenge)
    const europePmcUrl = convertToEuropePmcUrl(url);
    if (europePmcUrl) {
      console.log(`[PDF Download] Trying EuropePMC: ${europePmcUrl.substring(0, 60)}...`);
      const pmcResult = await tryDownload(europePmcUrl, maxRetries, timeout);
      if (pmcResult.success) {
        return { ...pmcResult, source: 'pmc-conversion' };
      }
      console.log(`[PDF Download] EuropePMC failed, falling back to original URL`);
    }

    // Try alternative OA URLs if DOI provided
    if (options.doi) {
      const alternativeUrls = await fetchAlternativeOaUrls(options.doi);
      for (const altUrl of alternativeUrls.slice(0, 3)) { // Try top 3
        console.log(`[PDF Download] Trying alternative OA: ${altUrl.substring(0, 60)}...`);
        const altResult = await tryDownload(altUrl, maxRetries, timeout);
        if (altResult.success) {
          return { ...altResult, source: 'alternative-oa' };
        }
      }
    }

    // Standard download with retry
    const result = await tryDownload(url, maxRetries, timeout);
    if (result.success) {
      return { ...result, source: 'direct' };
    }

    return result;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

/**
 * Try to download PDF from URL
 */
async function tryDownload(
  url: string,
  maxRetries: number,
  timeout: number
): Promise<DownloadPdfResult> {
  const response = await fetchPdfWithRetry(url, maxRetries, timeout);

  // Check for Cloudflare bot protection
  const cfMitigated = response.headers.get("cf-mitigated");
  if (response.status === 403 && cfMitigated) {
    return {
      success: false,
      error: `Cloudflare bot protection detected - requires browser`,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  const contentType = response.headers.get("content-type") || "";
  
  // If HTML, extract PDF URL from it
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const html = await response.text();
    
    // Check for PMC PoW challenge page
    if (html.includes('<title>Preparing to download') || html.includes('POW_CHALLENGE')) {
      return {
        success: false,
        error: "PMC proof-of-work challenge page - cannot bypass",
      };
    }
    
    const pdfUrl = extractPdfUrlFromHtml(html, url);
    
    if (!pdfUrl) {
      return {
        success: false,
        error: "No PDF link found in HTML",
      };
    }

    // Download the extracted PDF URL
    const pdfResponse = await fetchPdfWithRetry(pdfUrl, maxRetries, timeout, url);
    
    if (!pdfResponse.ok) {
      return {
        success: false,
        error: `HTTP ${pdfResponse.status}: ${pdfResponse.statusText}`,
      };
    }

    const pdfData = await pdfResponse.arrayBuffer();
    return { success: true, pdfData, source: 'html-extraction' };
  }

  // Direct PDF download
  if (!contentType.includes("application/pdf")) {
    return {
      success: false,
      error: `Not a PDF: ${contentType}`,
    };
  }

  const pdfData = await response.arrayBuffer();
  
  if (pdfData.byteLength === 0) {
    return { success: false, error: "Empty PDF response" };
  }

  return { success: true, pdfData };
}

/**
 * Download PDF from Zotero attachment
 */
async function downloadZoteroPdf(
  zoteroUrl: string,
  connection: { apiKey: string; userId: string },
  timeout: number,
  maxRetries: number
): Promise<DownloadPdfResult> {
  try {
    // Parse Zotero URL to get item key
    const match = zoteroUrl.match(/zotero:\/\/select\/groups\/(\d+)\/items\/(\w+)/);
    if (!match) {
      return { success: false, error: "Invalid Zotero URL format" };
    }

    const groupId = match[1];
    const itemKey = match[2];

    // Fetch attachments
    const attachmentsUrl = `https://api.zotero.org/groups/${groupId}/items/${itemKey}/children?format=json`;
    
    const response = await fetchWithTimeout(
      attachmentsUrl,
      {
        headers: {
          "Zotero-API-Key": connection.apiKey,
          "Zotero-API-Version": "3",
        },
      },
      timeout
    );

    if (!response.ok) {
      return { success: false, error: `Zotero API error: ${response.status}` };
    }

    const attachments = await response.json();
    
    // Find PDF attachment
    const pdfAttachment = attachments.find(
      (att: any) => att.data?.itemType === "attachment" && att.data?.contentType === "application/pdf"
    );

    if (!pdfAttachment) {
      return { success: false, error: "No PDF attachment found in Zotero" };
    }

    // Download the PDF
    const downloadUrl = pdfAttachment.links?.enclosure?.href;
    if (!downloadUrl) {
      return { success: false, error: "No download URL for Zotero attachment" };
    }

    const pdfResponse = await fetchWithTimeout(
      downloadUrl,
      {
        headers: {
          "Zotero-API-Key": connection.apiKey,
        },
      },
      timeout
    );

    if (!pdfResponse.ok) {
      return { success: false, error: `Zotero download failed: ${pdfResponse.status}` };
    }

    const pdfData = await pdfResponse.arrayBuffer();
    return { success: true, pdfData };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

/**
 * Convert PMC/NCBI URLs to EuropePMC direct PDF URLs
 * Bypasses JavaScript proof-of-work challenge
 */
function convertToEuropePmcUrl(url: string): string | null {
  const pmcMatch = url.match(/(?:ncbi\.nlm\.nih\.gov\/pmc|pmc\.ncbi\.nlm\.nih\.gov)\/articles\/(?:PMC)?(\d+)/i);
  if (pmcMatch) {
    const pmcId = pmcMatch[1];
    return `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcId}&blobtype=pdf`;
  }
  return null;
}

/**
 * Fetch alternative OA URLs from multiple sources
 */
async function fetchAlternativeOaUrls(doi: string): Promise<string[]> {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '');
  const pdfUrls: Set<string> = new Set();
  
  // Fetch from OpenAlex
  try {
    const response = await fetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=locations`,
      {
        headers: {
          "User-Agent": "OpenCode-PDFFetcher/1.0",
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
    console.log(`[PDF Download] OpenAlex lookup failed: ${e}`);
  }
  
  // Fetch from Unpaywall
  try {
    const response = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=user@example.com`,
      {
        headers: {
          "User-Agent": "OpenCode-PDFFetcher/1.0",
        },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.best_oa_location?.url_for_pdf) {
        pdfUrls.add(data.best_oa_location.url_for_pdf);
      }
      
      for (const loc of (data.oa_locations || [])) {
        if (loc.url_for_pdf && typeof loc.url_for_pdf === 'string') {
          pdfUrls.add(loc.url_for_pdf);
        }
        // Convert PMC landing pages to EuropePMC
        if (loc.url_for_landing_page && typeof loc.url_for_landing_page === 'string') {
          const europePmcUrl = convertToEuropePmcUrl(loc.url_for_landing_page);
          if (europePmcUrl) {
            pdfUrls.add(europePmcUrl);
          }
        }
      }
    }
  } catch (e) {
    console.log(`[PDF Download] Unpaywall lookup failed: ${e}`);
  }
  
  // Prioritize repositories
  const urlArray = Array.from(pdfUrls);
  const repositoryPatterns = [
    /europepmc\.org/i,
    /arxiv\.org/i,
    /\.edu\//i,
    /repository/i,
    /\.ac\./i,
    /zenodo\.org/i,
    /figshare\.com/i,
    /biorxiv\.org/i,
    /medrxiv\.org/i,
  ];
  
  const isRepository = (url: string) => repositoryPatterns.some(p => p.test(url));
  
  urlArray.sort((a, b) => {
    const aIsRepo = isRepository(a);
    const bIsRepo = isRepository(b);
    if (aIsRepo && !bIsRepo) return -1;
    if (!aIsRepo && bIsRepo) return 1;
    return 0;
  });
  
  console.log(`[PDF Download] Found ${urlArray.length} alternative URLs for DOI ${cleanDoi}`);
  return urlArray;
}

/**
 * Fetch PDF with retry logic for transient errors
 */
async function fetchPdfWithRetry(
  url: string,
  maxRetries: number,
  timeout: number,
  referer?: string
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/pdf,*/*",
            ...(referer && { "Referer": referer }),
          },
          redirect: "follow",
        },
        timeout
      );

      // Only retry on transient errors (5xx, 429)
      if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
        console.log(`[PDF Download] Retry ${attempt + 1}/${maxRetries} for ${url.substring(0, 50)}... (${response.status})`);
        await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_CONFIG.RETRY_DELAY_MS));
        continue;
      }

      return response;
    } catch (e: any) {
      lastError = e;
      const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
      
      if (isTimeout && attempt < maxRetries) {
        console.log(`[PDF Download] Timeout retry ${attempt + 1}/${maxRetries} for ${url.substring(0, 50)}...`);
        await new Promise((r) => setTimeout(r, PDF_DOWNLOAD_CONFIG.RETRY_DELAY_MS));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error("Fetch failed after retries");
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number
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
 * Extract PDF URL from HTML using multiple strategies
 * Priority order: citation_pdf_url > meta refresh > window.location > DC.identifier > 
 *                 link alternate > anchor tags > heuristics > embed > data attrs > onclick
 */
function extractPdfUrlFromHtml(html: string, baseUrl: string): string | null {
  // Priority 0: citation_pdf_url meta tag
  const metaTags = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/(?:name|property)=["']?([^"'\s>]+)["']?/i);
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    
    if (nameMatch && contentMatch) {
      const name = nameMatch[1].toLowerCase();
      const content = contentMatch[1];
      
      if (name === 'citation_pdf_url') {
        return resolveUrl(content, baseUrl);
      }
    }
  }

  // Priority 1: Meta refresh redirect
  const metaRefreshMatch = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=(['"]?)([^"'\s>]+)\1["']?/i) ||
                           html.match(/<meta[^>]+content=["']?\d+;\s*url=(['"]?)([^"'\s>]+)\1["']?[^>]+http-equiv=["']?refresh["']?/i);
  if (metaRefreshMatch) {
    let redirectUrl = metaRefreshMatch[2].replace(/&amp;/g, '&');
    return resolveUrl(redirectUrl, baseUrl);
  }

  // Priority 2: Window.location redirect
  const locationMatches = Array.from(html.matchAll(/(?:window|self)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi));
  for (const match of locationMatches) {
    const redirectUrl = match[1];
    if (redirectUrl.includes('.pdf') || redirectUrl.includes('/files/') || 
        redirectUrl.includes('/download') || redirectUrl.includes('/bitstream')) {
      return resolveUrl(redirectUrl, baseUrl);
    }
  }

  // Priority 3: DC.identifier, og:url with .pdf
  for (const tag of metaTags) {
    const nameMatch = tag.match(/(?:name|property)=["']?([^"'\s>]+)["']?/i);
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    
    if (nameMatch && contentMatch) {
      const name = nameMatch[1].toLowerCase();
      const content = contentMatch[1];
      
      if (name === 'dc.identifier' && content.toLowerCase().includes('.pdf')) {
        return resolveUrl(content, baseUrl);
      }
      if (name === 'og:url' && content.toLowerCase().includes('.pdf')) {
        return resolveUrl(content, baseUrl);
      }
    }
  }

  // Priority 4: Link alternate
  const linkTags = html.match(/<link[^>]+>/gi) || [];
  for (const tag of linkTags) {
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    
    if (typeMatch && typeMatch[1].toLowerCase() === 'application/pdf' && hrefMatch) {
      return resolveUrl(hrefMatch[1], baseUrl);
    }
  }

  // Priority 5: Anchor tags with .pdf
  const anchorTags = html.match(/<a[^>]+>/gi) || [];
  const pdfLinks: string[] = [];
  for (const tag of anchorTags) {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch && hrefMatch[1].toLowerCase().includes('.pdf')) {
      pdfLinks.push(hrefMatch[1]);
    }
  }
  
  if (pdfLinks.length > 0) {
    const priorityLink = pdfLinks.find(link => 
      /\/(bitstream|download|pdf|fulltext|content)\//i.test(link)
    );
    return resolveUrl(priorityLink || pdfLinks[0], baseUrl);
  }

  // Priority 6: Heuristic text matching
  const linkContentRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkContentRegex.exec(html)) !== null) {
    const href = match[1];
    const content = match[2];
    
    if (/(?:Download|View|Full\s*Text|Get).*?PDF|PDF.*?Download/i.test(content) || 
        />\s*PDF\s*</i.test(content) ||
        /class=["'].*?pdf.*?["']/i.test(match[0])) {
      if (!href.startsWith("javascript:") && !href.startsWith("#") && !href.startsWith("mailto:")) {
        return resolveUrl(href, baseUrl);
      }
    }
  }

  // Priority 7: Embed/iframe/object
  const embedMatch = html.match(/<(?:embed|iframe|object)[^>]+(?:src|data)=["']([^"']*\.pdf[^"']*)["']/i);
  if (embedMatch) {
    return resolveUrl(embedMatch[1], baseUrl);
  }

  // Priority 8: Data attributes
  const dataAttrMatch = html.match(/data-(?:pdf|download)-url=["']([^"']+)["']/i);
  if (dataAttrMatch) {
    return resolveUrl(dataAttrMatch[1], baseUrl);
  }

  // Priority 9: Window.open in onclick
  const onclickMatch = html.match(/onclick=["']window\.open\(["']([^"']+\.pdf)["']\)/i);
  if (onclickMatch) {
    return resolveUrl(onclickMatch[1], baseUrl);
  }

  return null;
}

/**
 * Resolve a potentially relative URL against a base URL
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}
