/**
 * Multi-tier parsing waterfall for academic paper full-text retrieval.
 *
 * Exported function: parseFullText(doi, openalexId) -> { bodyText, parsingSource }
 *
 * Tier order (cheapest first):
 *   1. PMC JATS XML via Europe PMC (free, structured)
 *   2. arXiv HTML (free, semi-structured)
 *   3. unpdf local PDF extraction (free, unstructured)
 *   4. Gemini-as-PDF-parser via @ai-sdk/google (near-free, LLM)
 *   5. Abstract-only fallback from OpenAlex inverted index
 *
 * Each tier has a hard AbortSignal.timeout ceiling per D-11.
 * PDFs with >200 pages are rejected before parsing (PARSE-10).
 *
 * This is a pure async module -- NOT a Convex function file.
 * No "use node" directive, no function registrations.
 * Imported by the "use node" workpool action file.
 */

import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import { getDocumentProxy, extractText } from "unpdf";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { reconstructAbstract } from "../../lib/openalex/reconstruct-abstract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsingSource =
  | "pmc"
  | "arxiv"
  | "unpdf"
  | "gemini"
  | "abstract_only";

export interface ParseResult {
  bodyText: string;
  parsingSource: ParsingSource;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OpenAlexMetadata {
  pmcId: string | null;
  arxivId: string | null;
  pdfUrl: string | null;
  abstractInvertedIndex: Record<string, number[]> | null;
}

// Loose shape for the OpenAlex Work object -- only the fields we access.
interface OpenAlexWork {
  ids?: { pmcid?: string };
  locations?: Array<{
    source?: { display_name?: string };
    landing_page_url?: string;
    id?: string;
    pdf_url?: string;
  }>;
  primary_location?: {
    landing_page_url?: string;
    pdf_url?: string;
  };
  best_oa_location?: {
    pdf_url?: string;
  };
  abstract_inverted_index?: Record<string, number[]>;
  doi?: string;
}

// ---------------------------------------------------------------------------
// Timeout utility (D-12)
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return fn(signal);
}

// ---------------------------------------------------------------------------
// OpenAlex metadata fetch (D-04, D-05)
// ---------------------------------------------------------------------------

async function fetchOpenAlexMetadata(
  doi: string,
  openalexId: string,
  signal: AbortSignal
): Promise<OpenAlexMetadata & { _raw: OpenAlexWork }> {
  const email =
    process.env.OPENALEX_CONTACT_EMAIL ?? "openscholar@sickrin.com";

  let url: string;
  if (doi) {
    url = `https://api.openalex.org/works/https://doi.org/${doi}?mailto=${email}`;
  } else {
    // Fall back to OpenAlex ID. Extract work ID from full URL if needed
    // (same pattern as convex/library/backfill.ts).
    const workId = openalexId.includes("/")
      ? openalexId.split("/").pop()!
      : openalexId;
    url = `https://api.openalex.org/works/${workId}?mailto=${email}`;
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `[ParseWaterfall] OpenAlex returned ${response.status} for ${doi || openalexId}`
    );
  }

  const work: OpenAlexWork = await response.json();

  return {
    pmcId: extractPmcId(work),
    arxivId: extractArxivId(work, doi),
    pdfUrl: extractPdfUrl(work),
    abstractInvertedIndex: work.abstract_inverted_index ?? null,
    _raw: work,
  };
}

// ---------------------------------------------------------------------------
// ID extraction helpers (verified against live API -- RESEARCH.md Pattern 3)
// ---------------------------------------------------------------------------

/**
 * Extract PMCID from OpenAlex work metadata.
 *
 * Strategy:
 * 1. Check work.ids.pmcid -- if present, extract PMC\d+ via regex
 * 2. Check work.locations for PubMed Central source -- extract from landing_page_url
 * 3. Check location id fields for pubmedcentral.nih.gov prefix
 */
function extractPmcId(work: OpenAlexWork): string | null {
  // 1. Direct ids.pmcid field
  if (work.ids?.pmcid) {
    const match = work.ids.pmcid.match(/PMC\d+/);
    if (match) return match[0];
  }

  // 2. Check locations for PubMed Central source
  if (work.locations) {
    for (const loc of work.locations) {
      if (loc.source?.display_name === "PubMed Central" && loc.landing_page_url) {
        const match = loc.landing_page_url.match(/\/pmc\/articles\/(\d+)\//);
        if (match) return `PMC${match[1]}`;

        // Also try PMC\d+ pattern directly in URL
        const pmcMatch = loc.landing_page_url.match(/(PMC\d+)/);
        if (pmcMatch) return pmcMatch[1];
      }
    }
  }

  // 3. Check location id fields for pubmedcentral.nih.gov prefix
  if (work.locations) {
    for (const loc of work.locations) {
      if (loc.id && loc.id.includes("pubmedcentral.nih.gov:")) {
        const parts = loc.id.split(":");
        const numericId = parts[parts.length - 1];
        if (numericId && /^\d+$/.test(numericId)) {
          return `PMC${numericId}`;
        }
      }
    }
  }

  return null;
}

/**
 * Extract arXiv ID from OpenAlex work metadata.
 *
 * Strategy:
 * 1. Check primary_location.landing_page_url for arxiv.org/abs pattern
 * 2. Check locations array for pmh:oai:arXiv.org prefix
 * 3. Check DOI for arXiv DOIs (10.48550/arxiv.*)
 */
function extractArxivId(work: OpenAlexWork, doi: string): string | null {
  // 1. Primary location landing page
  if (work.primary_location?.landing_page_url) {
    const match = work.primary_location.landing_page_url.match(
      /arxiv\.org\/abs\/(\d+\.\d+)/
    );
    if (match) return match[1];
  }

  // 2. Locations array for pmh:oai:arXiv.org prefix
  if (work.locations) {
    for (const loc of work.locations) {
      if (loc.id && loc.id.startsWith("pmh:oai:arXiv.org:")) {
        return loc.id.replace("pmh:oai:arXiv.org:", "");
      }
    }
  }

  // 3. arXiv DOI pattern (case-insensitive)
  if (doi) {
    const match = doi.match(/10\.48550\/arxiv\.(\d+\.\d+)/i);
    if (match) return match[1];
  }

  return null;
}

/**
 * Extract best available PDF URL from OpenAlex work metadata.
 * Prefers best_oa_location, falls back to primary_location.
 */
function extractPdfUrl(work: OpenAlexWork): string | null {
  return (
    work.best_oa_location?.pdf_url ??
    work.primary_location?.pdf_url ??
    null
  );
}

// ---------------------------------------------------------------------------
// Tier 1: PMC JATS XML (PARSE-02)
// ---------------------------------------------------------------------------

async function parsePmc(pmcId: string, signal: AbortSignal): Promise<string> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcId}/fullTextXML`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Europe PMC returned ${response.status} for ${pmcId}`
    );
  }
  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
  });
  const result = parser.parse(xml);
  const body = result?.article?.body;
  if (!body) throw new Error("No <body> element in JATS XML");
  return extractTextFromJatsBody(body);
}

/**
 * Recursively extract text from a parsed JATS body object.
 * fast-xml-parser returns nested objects/arrays/strings for XML elements.
 */
function extractTextFromJatsBody(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map(extractTextFromJatsBody).join(" ");
  }
  if (typeof node === "object" && node !== null) {
    return Object.values(node).map(extractTextFromJatsBody).join(" ");
  }
  return String(node);
}

// ---------------------------------------------------------------------------
// Tier 2: arXiv HTML (PARSE-03)
// ---------------------------------------------------------------------------

async function parseArxiv(
  arxivId: string,
  signal: AbortSignal
): Promise<string> {
  const url = `https://arxiv.org/html/${arxivId}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `arXiv HTML returned ${response.status} for ${arxivId}`
    );
  }
  const html = await response.text();
  const { document } = parseHTML(html);
  const article =
    document.querySelector("article") ??
    document.querySelector(".ltx_page_main") ??
    document.querySelector("main");
  if (!article) throw new Error("No article element found in arXiv HTML");
  article
    .querySelectorAll("script, style, nav, .ltx_bibliography")
    .forEach((el) => el.remove());
  const text = article.textContent?.trim() ?? "";
  if (text.length === 0) throw new Error("Empty text content from arXiv HTML");
  return text;
}

// ---------------------------------------------------------------------------
// Tier 3: unpdf local PDF extraction (PARSE-04, PARSE-10)
// ---------------------------------------------------------------------------

async function parsePdfWithUnpdf(
  pdfUrl: string,
  signal: AbortSignal
): Promise<{ text: string; totalPages: number }> {
  const response = await fetch(pdfUrl, { signal });
  if (!response.ok) {
    throw new Error(`PDF fetch returned ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  if (pdf.numPages > 200) {
    throw new Error(`PDF has ${pdf.numPages} pages (max 200)`);
  }

  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: text as string, totalPages };
}

// ---------------------------------------------------------------------------
// Tier 4: Gemini-as-PDF-parser (PARSE-05, D-09, D-10)
// ---------------------------------------------------------------------------

async function parseWithGemini(
  pdfUrl: string,
  signal: AbortSignal
): Promise<string> {
  // Fetch PDF data with a separate 20s timeout for the download
  const pdfResponse = await fetch(pdfUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!pdfResponse.ok) {
    throw new Error(`PDF fetch returned ${pdfResponse.status}`);
  }
  const pdfData = new Uint8Array(await pdfResponse.arrayBuffer());

  const google = createGoogleGenerativeAI();
  const result = await generateText({
    model: google("gemini-2.5-flash-lite"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all text from this document. Return only the document text, no commentary.",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            data: pdfData,
          },
        ],
      },
    ],
    temperature: 0,
    providerOptions: {
      google: {
        mediaResolution: "MEDIA_RESOLUTION_LOW",
      },
    },
    abortSignal: signal,
  });

  return result.text;
}

// ---------------------------------------------------------------------------
// Main waterfall (D-02, D-03)
// ---------------------------------------------------------------------------

const MIN_UNPDF_CHARS = 1500;

/**
 * Parse full text for an academic paper using a multi-tier waterfall.
 *
 * Tries each source in order of cost (cheapest first):
 * PMC JATS -> arXiv HTML -> unpdf -> Gemini -> abstract-only
 *
 * @param doi - The paper's DOI (may be empty string)
 * @param openalexId - The paper's OpenAlex ID (URL or bare ID)
 * @returns ParseResult with bodyText and parsingSource tag
 */
export async function parseFullText(
  doi: string,
  openalexId: string
): Promise<ParseResult> {
  // 1. Fetch OpenAlex metadata (20s timeout -- D-11)
  const metadata = await withTimeout(
    (signal) => fetchOpenAlexMetadata(doi, openalexId, signal),
    20_000
  );

  const { pmcId, arxivId, pdfUrl, abstractInvertedIndex } = metadata;
  const paperId = doi || openalexId;

  // 2. Tier 1: PMC JATS XML (30s timeout)
  if (pmcId) {
    try {
      const bodyText = await withTimeout(
        (signal) => parsePmc(pmcId, signal),
        30_000
      );
      if (bodyText.length > 0) {
        return { bodyText, parsingSource: "pmc" };
      }
    } catch (error) {
      console.warn(
        `[ParseWaterfall] PMC tier failed for ${paperId} (${pmcId}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 3. Tier 2: arXiv HTML (30s timeout)
  if (arxivId) {
    try {
      const bodyText = await withTimeout(
        (signal) => parseArxiv(arxivId, signal),
        30_000
      );
      if (bodyText.length > 0) {
        return { bodyText, parsingSource: "arxiv" };
      }
    } catch (error) {
      console.warn(
        `[ParseWaterfall] arXiv tier failed for ${paperId} (${arxivId}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 4. Tier 3: unpdf local PDF extraction (60s timeout)
  if (pdfUrl) {
    let unpdfText: string | null = null;

    try {
      const { text } = await withTimeout(
        (signal) => parsePdfWithUnpdf(pdfUrl, signal),
        60_000
      );
      unpdfText = text;
    } catch (error) {
      console.warn(
        `[ParseWaterfall] unpdf tier failed for ${paperId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Check if unpdf produced sufficient text
    if (unpdfText !== null && unpdfText.length >= MIN_UNPDF_CHARS) {
      return { bodyText: unpdfText, parsingSource: "unpdf" };
    }

    // 5. Tier 4: Gemini-as-PDF-parser (120s timeout)
    // Triggered when unpdf returns <1500 chars OR throws (PARSE-05)
    if (unpdfText === null || unpdfText.length < MIN_UNPDF_CHARS) {
      try {
        const bodyText = await withTimeout(
          (signal) => parseWithGemini(pdfUrl, signal),
          120_000
        );
        if (bodyText.length > 0) {
          return { bodyText, parsingSource: "gemini" };
        }
      } catch (error) {
        console.warn(
          `[ParseWaterfall] Gemini tier failed for ${paperId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // 6. Tier 5: Abstract-only fallback (PARSE-06)
  const abstractText = abstractInvertedIndex
    ? reconstructAbstract(abstractInvertedIndex)
    : "";

  return {
    bodyText: abstractText,
    parsingSource: "abstract_only",
  };
}
