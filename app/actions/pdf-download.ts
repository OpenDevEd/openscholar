"use server";

import { buildZoteroHeaders, isZoteroFileUrl } from '@/lib/zotero-utils';

export interface PDFDownloadResult {
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
  filename?: string;
}

/**
 * Download a PDF from a URL on the server side to avoid CORS issues
 */
export async function downloadPDFFromURL(url: string, filename?: string): Promise<PDFDownloadResult> {
  try {
    console.log(`Downloading PDF from URL: ${url}`);
    
    // Base headers always include user-agent and Zotero version; Accept is appended below
    let headers: Record<string, string> = {
      'Accept': 'application/pdf,application/octet-stream,*/*',
      ...buildZoteroHeaders(),
    };

    const isZoteroApiUrl = isZoteroFileUrl(url);
    if (isZoteroApiUrl) {
      const urlObj = new URL(url);
      const apiKey = urlObj.searchParams.get('key');
      
      if (apiKey) {
        // If we have API key in URL, remove it and switch to header-based auth
        urlObj.searchParams.delete('key');
        url = urlObj.toString();
        headers = {
          ...headers,
          ...buildZoteroHeaders(apiKey),
        };
        console.log('Using Zotero header auth for server download');
      }
    }
    
    // For Zotero URLs, first do HEAD request to get final URL
    if (isZoteroApiUrl) {
      const headResponse = await fetch(url, {
        method: 'HEAD',
        headers,
        redirect: 'follow',
      });

      // Handle rate limiting
      if (headResponse.status === 429) {
        const retryAfter = headResponse.headers.get('Retry-After');
        throw new Error(`Rate limited by Zotero API. Retry after ${retryAfter} seconds`);
      }

      // Handle backoff requests
      const backoff = headResponse.headers.get('Backoff');
      if (backoff) {
        console.warn(`Zotero API requests backoff of ${backoff} seconds`);
      }

      if (!headResponse.ok) {
        throw new Error(`Failed to get Zotero file URL. Status: ${headResponse.status} ${headResponse.statusText}`);
      }

      // Use the final URL from HEAD request for GET
      url = headResponse.url;
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    // Handle rate limiting for GET request
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new Error(`Rate limited by Zotero API. Retry after ${retryAfter} seconds`);
    }

    if (!response.ok) {
      throw new Error(`Failed to download PDF. Status: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      console.warn(`Unexpected content type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    
    return {
      success: true,
      data: arrayBuffer,
      filename: filename || 'document.pdf',
    };
  } catch (error) {
    console.error('PDF download error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown PDF download error',
    };
  }
}

/**
 * Batch download multiple PDFs from URLs
 */
export async function downloadMultiplePDFs(urls: string[]): Promise<(PDFDownloadResult & { url: string })[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => await downloadPDFFromURL(url))
  );

  return results.map((result, index) => {
    const url = urls[index];
    if (result.status === 'fulfilled') {
      return {
        ...result.value,
        url,
      };
    } else {
      return {
        success: false,
        error: result.reason instanceof Error ? result.reason.message : 'Failed to download PDF',
        url,
      };
    }
  });
}