/**
 * A paper's PDF by its address, as raw bytes: no text extraction and no database.
 *
 * A file in a person's Zotero library is read through Zotero's API with their key. Any other paper goes through the
 * search Openscholar shares with Evidence Community (@opendeved/paper-pdf): the paper's own link first, then the
 * links Crossref, Unpaywall and OpenAlex hold, the PDFs that pages declare, PubMed Central's open storage and the
 * Internet Archive's copy of a link that refused or is gone. It never buys a copy: convex/lib/paperPdfs.ts does.
 */

import { findPdf, type Memory, type Missed } from "@opendeved/paper-pdf";
import { buildZoteroHeaders } from "../zotero-utils";
import { MAX_PDF_BYTES } from "../files/limits";
import { readCappedBody } from "./url-allowlist";

const ZOTERO_TIMEOUT_MS = 30_000;

export interface DownloadPdfOptions {
  zoteroConnection?: {
    apiKey: string;
    userId: string;
  };
  doi?: string;
  /** OpenAlex's ID for the paper, which says its link is OpenAlex's. */
  openalexId?: string;
  /** Fetches plain-HTTP addresses too, still behind the private-address guard. */
  allowHttp?: boolean;
  /** Stops a response past this many bytes while it streams. The shared PDF cap otherwise. */
  maxBytes?: number;
  /** Where a paper that had no copy is remembered, so it isn't searched again until its time. */
  memory?: Memory;
}

export interface DownloadPdfResult {
  success: boolean;
  pdfBlob?: Blob;
  error?: string;
}

const WHY: Record<Missed["reason"], string> = {
  closed: "This paper isn't open access.",
  blocked: "The site that holds this paper's PDF refuses automated requests.",
  no_pdf: "No link to this paper returned its PDF.",
  unreachable: "The sites that hold this paper's PDF didn't answer.",
};

/** A paper's PDF from a person's Zotero library, or from wherever an open copy of it is. */
export async function downloadPdf(
  url: string,
  options: DownloadPdfOptions = {}
): Promise<DownloadPdfResult> {
  try {
    if (url.startsWith("zotero://") && options.zoteroConnection) {
      return await downloadZoteroPdf(url, options.zoteroConnection, ZOTERO_TIMEOUT_MS, options.maxBytes ?? MAX_PDF_BYTES);
    }
    const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
    const result = await findPdf(
      { doi: options.doi, openalexId: options.openalexId, urls: /^https?:\/\//i.test(url) ? [url] : [] },
      {
        userAgent: "Openscholar (https://openscholar.ai)",
        ...(contactEmail ? { contactEmail } : {}),
        ...(options.memory ? { memory: options.memory } : {}),
        maxBytes: options.maxBytes ?? MAX_PDF_BYTES,
        httpsOnly: !options.allowHttp,
      },
    );
    if (result.ok) return { success: true, pdfBlob: new Blob([result.bytes.slice().buffer], { type: "application/pdf" }) };
    return { success: false, error: WHY[result.reason] };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

/** Attachments one read of an item's gives, the most Zotero lists at once, and how many such reads look for its PDF. */
const ZOTERO_CHILD_PAGE = 100;
const ZOTERO_CHILD_PAGES = 10;

/**
 * Download PDF from Zotero attachment
 */
async function downloadZoteroPdf(
  zoteroUrl: string,
  connection: { apiKey: string; userId: string },
  timeout: number,
  maxBytes: number,
): Promise<DownloadPdfResult> {
  try {
    // Parse Zotero URL to get item key
    const groupMatch = zoteroUrl.match(/zotero:\/\/select\/groups\/(\d+)\/items\/(\w+)/);
    const userMatch = zoteroUrl.match(/zotero:\/\/select\/users\/(\d+)\/items\/(\w+)/);
    if (!groupMatch && !userMatch) {
      return { success: false, error: "Invalid Zotero URL format" };
    }

    const groupId = groupMatch ? groupMatch[1] : null;
    const userId = userMatch ? userMatch[1] : null;
    const itemKey = groupMatch ? groupMatch[2] : userMatch ? userMatch[2] : "";
    const libraryId = groupId ?? userId ?? "";
    const libraryType = groupId ? "groups" : "users";

    // Find PDF attachment
    interface ZoteroAttachment {
      data?: {
        itemType?: string;
        contentType?: string;
      };
      links?: {
        enclosure?: {
          href?: string;
        };
      };
    }

    // Its attachments a page of Zotero's at a time, until a PDF: an item can have more than one page of them.
    // shortcut: up to ZOTERO_CHILD_PAGES pages; an item with more attachments than that is read as having no PDF.
    let pdfAttachment: ZoteroAttachment | undefined;
    for (let page = 0; page < ZOTERO_CHILD_PAGES && !pdfAttachment; page++) {
      const response = await fetchWithTimeout(
        `https://api.zotero.org/${libraryType}/${libraryId}/items/${itemKey}/children?format=json&itemType=attachment&limit=${ZOTERO_CHILD_PAGE}&start=${page * ZOTERO_CHILD_PAGE}`,
        { headers: buildZoteroHeaders(connection.apiKey) },
        timeout
      );
      if (!response.ok) {
        return { success: false, error: `Zotero API error: ${response.status}` };
      }
      const attachments = (await response.json()) as ZoteroAttachment[];
      pdfAttachment = attachments.find(
        (att) => att.data?.itemType === "attachment" && att.data?.contentType === "application/pdf"
      );
      if (attachments.length < ZOTERO_CHILD_PAGE) break;
    }

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
        headers: buildZoteroHeaders(connection.apiKey),
      },
      timeout
    );

    if (!pdfResponse.ok) {
      return { success: false, error: `Zotero download failed: ${pdfResponse.status}` };
    }

    // Read no further than the cap: a larger file stops here, never held whole.
    const pdfBlob = await readCappedBody(pdfResponse, maxBytes);
    return { success: true, pdfBlob };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
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
