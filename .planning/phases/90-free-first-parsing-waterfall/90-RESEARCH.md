# Phase 90: Free-First Parsing Waterfall - Research

**Researched:** 2026-04-15
**Domain:** Academic paper full-text retrieval and parsing (PMC JATS XML, arXiv HTML, PDF extraction, Gemini-as-PDF-parser)
**Confidence:** HIGH

## Summary

Phase 90 fills the `processExtractionPaper` workpool action stub from Phase 89 with a multi-tier parsing waterfall that retrieves body text from the cheapest upstream source available: PMC JATS XML (free), arXiv HTML (free), unpdf local PDF extraction (free), Gemini-as-PDF-parser (near-free), then abstract-only fallback. Each tier has hard `AbortSignal.timeout` ceilings, and the pipeline rejects PDFs over 200 pages.

The implementation lives in a single `convex/extraction/parse.ts` module exporting `parseFullText()`, called from the existing workpool action. The schema adds two fields (`bodyText`, `parsingSource`) to the `extractionPapers` table. Three new dependencies are needed: `fast-xml-parser` (XML parsing), `linkedom` (HTML DOM parsing), and `unpdf` (serverless PDF.js). A new `convex.json` file pins Node 22 and marks `unpdf` as an external package.

**Primary recommendation:** Implement the waterfall as a linear try/catch chain within a single module file. Each tier is a separate internal function. The key technical risk is metadata resolution -- extracting PMCID and arXiv ID from OpenAlex `locations` arrays rather than the `ids` object, since OpenAlex does not reliably populate `ids.pmcid`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Waterfall parsing logic lives in a separate `convex/extraction/parse.ts` module, NOT inlined in `workpoolActions.ts`. The workpool action calls `parseFullText(paper)` and stores the result.
- **D-02:** `parse.ts` exports a single `parseFullText` function that takes paper metadata (DOI, OpenAlex IDs) and returns `{ bodyText: string, parsingSource: ParsingSource }` or throws on total failure.
- **D-03:** Each parsing tier (PMC, arXiv, unpdf, Gemini) is a separate internal function within `parse.ts` -- not separate files.
- **D-04:** The parsing pipeline fetches fresh OpenAlex metadata at parse time using the DOI stored on the `extractionPapers` row.
- **D-05:** OpenAlex metadata fetch uses the existing `OPENALEX_CONTACT_EMAIL` env var for polite pool access.
- **D-06:** arXiv ID extraction: parse from `ids.openalex` URL path or `primary_location.landing_page_url` matching `arxiv.org/abs/{id}` pattern.
- **D-07:** Parsed full text is stored directly as a `bodyText` field on the `extractionPapers` row.
- **D-08:** `extractionPapers` schema gets two new fields: `bodyText: v.optional(v.string())` and `parsingSource: v.optional(v.union(v.literal("pmc"), v.literal("arxiv"), v.literal("unpdf"), v.literal("gemini"), v.literal("abstract_only")))`.
- **D-09:** Gemini-as-PDF-parser uses `@ai-sdk/google` directly (NOT OpenRouter). OpenRouter does not support the `filePart` API needed for `media_resolution: 'low'` PDF parsing.
- **D-10:** Model for PDF parsing: Gemini 2.5 Flash Lite. Temperature: 0. Prompt: "Extract all text from this document. Return only the document text, no commentary."
- **D-11:** Each tier gets a hard `AbortSignal.timeout` ceiling: 20s fetch / 30s XML parse / 60s unpdf / 120s Gemini.
- **D-12:** A shared `withTimeout(fn, ms)` utility wraps each tier call.
- **D-13:** PDFs with >200 pages are rejected before parsing. Page count read from PDF metadata via `unpdf` utilities.
- **D-14:** Install `fast-xml-parser`, `linkedom`, and `unpdf`. These are the ONLY new dependencies.
- **D-15:** Create `convex.json` at project root with `{ "node": { "externalPackages": ["unpdf"] } }`.

### Claude's Discretion
- Error message format for each tier's failure logging -- follow the structured JSON pattern from REQUIREMENTS OBS-01 when available (Phase 95), otherwise use simple `console.warn`.
- Whether to cache OpenAlex metadata response for the duration of the job.
- The exact prompt text for Gemini-as-PDF-parser beyond the core instruction.
- Test fixture design: real XML/HTML snippets vs synthetic fixtures.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARSE-01 | Fetch OpenAlex metadata for each paper (DOI, abstract, `best_oa_location.pdf_url`, `ids.pmcid`, arXiv ID) | See "OpenAlex Metadata Resolution" section -- verified API structure, PMCID extraction from `locations` array, arXiv ID from `primary_location.landing_page_url` |
| PARSE-02 | Retrieve full body text from Europe PMC `fullTextXML` when `ids.pmcid` present, parse via `fast-xml-parser` | See "PMC JATS Tier" -- verified endpoint `https://www.ebi.ac.uk/europepmc/webservices/rest/{PMCID}/fullTextXML` returns JATS XML, `fast-xml-parser` v5.5.12 documented |
| PARSE-03 | Retrieve full body text from arXiv HTML when arXiv ID detected, parse via `linkedom` | See "arXiv HTML Tier" -- verified `https://arxiv.org/html/{id}` returns HTML (200 OK), `linkedom` v0.18.12 supports `parseHTML` and `querySelector` |
| PARSE-04 | Download and parse PDFs via `unpdf` when OA PDF URL exists | See "unpdf Tier" -- verified `unpdf` v1.6.0 API: `getDocumentProxy()` + `extractText()` with `mergePages: true` |
| PARSE-05 | Fall back to Gemini `filePart` with `media_resolution: 'low'` when unpdf < 1500 chars or throws | See "Gemini-as-PDF-Parser Tier" -- verified `@ai-sdk/google` supports `mediaResolution: 'MEDIA_RESOLUTION_LOW'` via provider options, file parts documented |
| PARSE-06 | Mark paper as `abstract_only` when all tiers fail | See "Abstract-Only Fallback" -- uses existing `reconstructAbstract()` from `lib/openalex/reconstruct-abstract.ts` |
| PARSE-07 | Per-paper `parsing_source` tag surfaced in UI | See "Schema Changes" -- new `parsingSource` field on `extractionPapers` table |
| PARSE-08 | Node.js runtime pinned to version 22 via `convex.json` | See "convex.json Configuration" -- verified `nodeVersion: "22"` is a supported value |
| PARSE-09 | Each tier has `AbortSignal.timeout` ceiling (20s/30s/60s/120s) | See "Timeout Architecture" -- `AbortSignal.timeout()` is native in Node 22, `withTimeout` wrapper pattern documented |
| PARSE-10 | PDFs > 200 pages rejected before parsing | See "Page Count Guard" -- `unpdf` `getDocumentProxy` + `totalPages` property before `extractText` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OpenAlex metadata fetch | API / Backend (Convex action) | -- | Server-side HTTP call; cannot expose polite-pool email to client |
| PMC JATS XML retrieval + parsing | API / Backend (Convex action) | -- | Server-side HTTP + XML parsing; `fast-xml-parser` is a Node.js library |
| arXiv HTML retrieval + parsing | API / Backend (Convex action) | -- | Server-side HTTP + DOM parsing; `linkedom` is Node.js only |
| PDF download + unpdf extraction | API / Backend (Convex action) | -- | Binary PDF processing requires Node.js runtime with `unpdf` |
| Gemini PDF parsing | API / Backend (Convex action) | -- | LLM API call with API key; must stay server-side |
| Body text storage | Database / Storage (Convex) | -- | Stored as string field on `extractionPapers` document |
| `parsing_source` UI rendering | Browser / Client | -- | Simple text badge on result card; Phase 97 scope |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fast-xml-parser` | 5.5.12 | Parse PMC JATS XML to JS object | Pure JS, zero C++ deps, handles JATS namespaces, fastest XML parser in npm benchmarks [VERIFIED: npm registry] |
| `linkedom` | 0.18.12 | Parse arXiv HTML and extract body text via DOM APIs | Lightweight DOM-like env for Node.js, supports `querySelector`/`textContent`, no JSDOM weight [VERIFIED: npm registry + Context7] |
| `unpdf` | 1.6.0 | Serverless PDF text extraction | Bundles PDF.js v5 for serverless environments (no Canvas, no native deps), designed for Cloudflare Workers and similar [VERIFIED: npm registry + Context7] |

### Already Installed (no new install needed)
| Library | Version | Purpose | Why Used |
|---------|---------|---------|----------|
| `@ai-sdk/google` | 3.0.18+ (installed) -> 3.0.63 (latest) | Gemini API for PDF parsing via `filePart` | Supports `mediaResolution: 'MEDIA_RESOLUTION_LOW'` for cheap PDF parsing [VERIFIED: source code inspection] |
| `ai` | 6.0.62 (installed) -> 6.0.160 (latest) | Vercel AI SDK core, `generateText` | Already used across the project [VERIFIED: package.json] |
| `zod` | 4.3.6 | Schema validation (if needed for parse result typing) | Already installed [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fast-xml-parser` | `cheerio` with XML mode | Cheerio is heavier (includes CSS selector engine); `fast-xml-parser` is purpose-built for XML |
| `linkedom` | `jsdom` | JSDOM is ~10x slower and heavier; `linkedom` is optimized for serverless |
| `linkedom` | `cheerio` | Cheerio lacks DOM APIs like `querySelector` chains; `linkedom` mirrors browser DOM |
| `unpdf` | `pdfjs-dist/legacy` | `pdfjs-dist` requires polyfills and canvas; `unpdf` bundles a serverless-ready build |

**Installation:**
```bash
npm install fast-xml-parser linkedom unpdf
```

**Version verification:**
- `fast-xml-parser`: 5.5.12 [VERIFIED: npm registry 2026-04-15]
- `linkedom`: 0.18.12 [VERIFIED: npm registry 2026-04-15]
- `unpdf`: 1.6.0 [VERIFIED: npm registry 2026-04-15]

## Architecture Patterns

### System Architecture Diagram

```
                            extractionPapers row
                                  |
                                  | (DOI + openalexId)
                                  v
                    +----------------------------+
                    |  processExtractionPaper     |
                    |  (workpoolActions.ts)       |
                    +----------------------------+
                                  |
                                  | calls parseFullText(paper)
                                  v
                    +----------------------------+
                    |  parseFullText()            |
                    |  (parse.ts)                 |
                    +----------------------------+
                                  |
                 1. Fetch OpenAlex metadata (DOI)
                                  |
                                  v
              +-----------------------------------------+
              |  OpenAlex API  (api.openalex.org/works)  |
              |  -> ids, locations, abstract_inverted_index |
              +-----------------------------------------+
                                  |
                    Extract PMCID + arXiv ID + PDF URL
                                  |
                  +---------------+----------------+
                  |               |                |
            has PMCID?      has arXiv ID?    has PDF URL?
                  |               |                |
                  v               v                v
          +-------------+ +-------------+ +---------------+
          | parsePmc()  | | parseArxiv()| | parsePdf()    |
          | Europe PMC  | | arxiv.org   | | unpdf ->      |
          | fullTextXML | | /html/{id}  | | Gemini fallbk |
          | fast-xml-   | | linkedom    | |               |
          | parser      | | textContent | |               |
          +-------------+ +-------------+ +---------------+
                  |               |                |
                  | 30s timeout   | 20s+30s        | 60s/120s
                  v               v                v
              +------------------------------------------+
              |  bodyText + parsingSource                  |
              |  Stored on extractionPapers row            |
              +------------------------------------------+
                                  |
                     All tiers failed?
                                  |
                                  v
                    +----------------------------+
                    |  abstract_only fallback     |
                    |  reconstructAbstract()      |
                    +----------------------------+
```

### Recommended Project Structure
```
convex/extraction/
  parse.ts              # NEW: parseFullText + tier functions
  workpoolActions.ts    # MODIFIED: calls parseFullText, stores result
  validators.ts         # MODIFIED: add parsingSource validator
  mutations.ts          # EXISTING: enqueue, save, finalize
  queries.ts            # EXISTING: progress, list
  workflow.ts           # EXISTING: workflow orchestration
  mutations.test.ts     # EXISTING: Phase 89 tests

convex/schema.ts        # MODIFIED: add bodyText + parsingSource fields

convex.json             # NEW: nodeVersion + externalPackages

tests/
  extraction/
    parse.test.ts       # NEW: unit tests for each parsing tier
```

### Pattern 1: Waterfall Try/Catch Chain
**What:** Linear waterfall where each tier is attempted in sequence; failures fall through to the next tier.
**When to use:** When you have multiple data sources of decreasing cost/reliability.
**Example:**
```typescript
// Source: CONTEXT.md D-03, verified against Convex action patterns
type ParsingSource = "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";

interface ParseResult {
  bodyText: string;
  parsingSource: ParsingSource;
}

export async function parseFullText(
  doi: string,
  openalexId: string
): Promise<ParseResult> {
  // 1. Fetch OpenAlex metadata
  const metadata = await withTimeout(
    () => fetchOpenAlexMetadata(doi, openalexId),
    20_000
  );

  // 2. Try PMC (free, structured XML)
  const pmcId = extractPmcId(metadata);
  if (pmcId) {
    try {
      const bodyText = await withTimeout(
        () => parsePmc(pmcId),
        30_000
      );
      if (bodyText.length > 0) {
        return { bodyText, parsingSource: "pmc" };
      }
    } catch { /* fall through */ }
  }

  // 3. Try arXiv HTML (free, rendered HTML)
  const arxivId = extractArxivId(metadata);
  if (arxivId) {
    try {
      const bodyText = await withTimeout(
        () => parseArxiv(arxivId),
        30_000 // 20s fetch + overhead
      );
      if (bodyText.length > 0) {
        return { bodyText, parsingSource: "arxiv" };
      }
    } catch { /* fall through */ }
  }

  // 4. Try unpdf (free, local PDF extraction)
  const pdfUrl = extractPdfUrl(metadata);
  if (pdfUrl) {
    try {
      const { text, totalPages } = await parsePdfWithUnpdf(pdfUrl);
      if (totalPages > 200) throw new Error("PDF exceeds 200-page cap");
      if (text.length >= 1500) {
        return { bodyText: text, parsingSource: "unpdf" };
      }
      // Fall through to Gemini if < 1500 chars
      const geminiText = await withTimeout(
        () => parseWithGemini(pdfUrl),
        120_000
      );
      return { bodyText: geminiText, parsingSource: "gemini" };
    } catch { /* fall through */ }
  }

  // 5. Abstract-only fallback
  const abstract = extractAbstract(metadata);
  return { bodyText: abstract, parsingSource: "abstract_only" };
}
```

### Pattern 2: withTimeout Utility
**What:** Thin wrapper that creates an `AbortSignal.timeout` and passes it to async work.
**When to use:** Every external fetch or CPU-intensive operation in the waterfall.
**Example:**
```typescript
// Source: Node.js 22 docs (AbortSignal.timeout is native)
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return fn(signal);
}

// Usage with fetch:
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return withTimeout(
    (signal) => fetch(url, { signal }),
    ms
  );
}
```

### Pattern 3: OpenAlex Metadata Resolution
**What:** Fetch fresh metadata from OpenAlex API and extract PMCID, arXiv ID, and PDF URL from the response.
**When to use:** At the start of every paper's parse pipeline.
**Example:**
```typescript
// Source: verified against live OpenAlex API responses [VERIFIED: API probing 2026-04-15]
interface OpenAlexMetadata {
  pmcId: string | null;
  arxivId: string | null;
  pdfUrl: string | null;
  abstractInvertedIndex: Record<string, number[]> | null;
}

function extractPmcId(work: OpenAlexWork): string | null {
  // 1. Check ids.pmcid (sometimes present)
  if (work.ids?.pmcid) {
    // Format: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567"
    const match = work.ids.pmcid.match(/PMC\d+/);
    return match ? match[0] : null;
  }
  // 2. Check locations for PubMed Central entries
  for (const loc of work.locations ?? []) {
    if (loc.source?.display_name === "PubMed Central" && loc.landing_page_url) {
      // e.g. "https://www.ncbi.nlm.nih.gov/pmc/articles/7395209"
      const match = loc.landing_page_url.match(/pmc\/articles\/(\d+)/);
      if (match) return `PMC${match[1]}`;
    }
    // Also check location id: "pmh:oai:pubmedcentral.nih.gov:7395209"
    if (loc.id?.includes("pubmedcentral.nih.gov:")) {
      const num = loc.id.split(":").pop();
      if (num) return `PMC${num}`;
    }
  }
  return null;
}

function extractArxivId(work: OpenAlexWork): string | null {
  // 1. Check primary_location.landing_page_url
  const landingUrl = work.primary_location?.landing_page_url ?? "";
  const absMatch = landingUrl.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
  if (absMatch) return absMatch[1];
  // 2. Check location ids
  for (const loc of work.locations ?? []) {
    if (loc.id?.startsWith("pmh:oai:arXiv.org:")) {
      return loc.id.replace("pmh:oai:arXiv.org:", "");
    }
  }
  // 3. Check DOI for arXiv DOIs
  const doi = work.ids?.doi ?? "";
  const doiMatch = doi.match(/10\.48550\/arxiv\.(\d+\.\d+)/i);
  if (doiMatch) return doiMatch[1];
  return null;
}
```

### Anti-Patterns to Avoid
- **Inlining parse logic in workpoolActions.ts:** Makes the waterfall untestable in isolation. Keep `parse.ts` as a pure module.
- **Using `pdfjs-dist` directly:** Requires Canvas polyfills and Node.js-specific build configuration. Use `unpdf` which bundles a serverless-ready PDF.js.
- **Catching all errors silently:** Each tier's catch must log the error source and message for debugging. The `console.warn` is essential even without OBS-01 structured logging.
- **Fetching OpenAlex metadata per-tier:** Fetch once at the start of `parseFullText`, pass the metadata object to each tier function. Avoids redundant API calls.
- **Trusting `ids.pmcid`:** OpenAlex does NOT reliably populate this field. Must also check `locations` array for PubMed Central entries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JATS XML to text extraction | Custom regex-based XML parser | `fast-xml-parser` | JATS has complex nested elements, namespaces, MathML; regex breaks on edge cases |
| HTML body text extraction | Manual string splitting/regex | `linkedom` `textContent` | HTML entities, nested tags, script/style removal all handled by DOM API |
| PDF text extraction | Custom PDF parser | `unpdf` (serverless PDF.js v5) | PDF is a binary format with font encoding, CMap tables, text reflow -- 10K+ edge cases |
| Timeout management | `setTimeout` + `Promise.race` | `AbortSignal.timeout()` (Node 22 native) | Native API properly cancels the underlying operation, not just the promise |
| Abstract reconstruction | Custom inverted index parser | Existing `reconstructAbstract()` in `lib/openalex/reconstruct-abstract.ts` | Already tested and deployed in production |

**Key insight:** Academic paper parsing has an extremely long tail of edge cases (encoding issues, mathematical notation, tables, supplementary materials). Using battle-tested libraries and accepting imperfect extraction is the correct MVP strategy.

## Common Pitfalls

### Pitfall 1: PMCID Not in `ids` Object
**What goes wrong:** Code checks `work.ids.pmcid` and finds it undefined for the majority of papers that have PMC full text available.
**Why it happens:** OpenAlex does not reliably populate the `ids.pmcid` field. The PMCID is more reliably found in the `locations` array under PubMed Central entries. [VERIFIED: live API probing of multiple papers with known PMCIDs showed `ids.pmcid` absent]
**How to avoid:** Always check both `ids.pmcid` AND the `locations` array for PubMed Central entries. Extract the PMC number from `landing_page_url` or location `id` fields.
**Warning signs:** PMC tier never fires despite papers having known PMC full text.

### Pitfall 2: arXiv HTML Not Available for All Papers
**What goes wrong:** Assuming all arXiv papers have HTML versions. Many older papers and some newer ones return 404.
**Why it happens:** arXiv HTML is still experimental. Not all LaTeX sources can be converted. Coverage is gradually increasing but is not 100%. [VERIFIED: `arxiv.org/html/2301.08766` returns 404, `arxiv.org/html/2402.08954` returns 200]
**How to avoid:** Treat the arXiv HTML fetch as a best-effort tier. A 404 response should gracefully fall through to the PDF tier. Always set a timeout on the fetch.
**Warning signs:** High failure rate on arXiv tier; many papers falling through to PDF unnecessarily.

### Pitfall 3: unpdf Returns Empty Text for Scanned PDFs
**What goes wrong:** `unpdf` returns an empty string or very short text for scanned/image-based PDFs that have no embedded text layer.
**Why it happens:** PDF.js extracts text from the text layer. Scanned PDFs store content as images with no text layer. `unpdf` cannot OCR.
**How to avoid:** The 1500-character threshold (PARSE-05) is the fallback trigger. If `unpdf` returns < 1500 chars, fall through to Gemini which can process the PDF as an image. [VERIFIED: Context7 unpdf docs confirm text extraction only, no OCR]
**Warning signs:** Many papers showing `gemini` as parsing source when they have text-based PDFs (indicates a different problem -- possibly encoding issues).

### Pitfall 4: Convex Action Timeout vs Tier Timeouts
**What goes wrong:** The sum of all tier timeouts (20 + 30 + 60 + 120 = 230s) exceeds Convex's action timeout limit.
**Why it happens:** Convex actions have a maximum execution time. If all tiers are tried sequentially and all time out, the action itself may time out.
**How to avoid:** In practice, a paper will hit at most 2-3 tiers (most papers resolve at PMC or arXiv). The timeouts are per-tier ceilings, not expected durations. However, ensure the workpool retry configuration accounts for this. The existing `maxParallelism: 5` with 3 retries is appropriate. [ASSUMED -- Convex action timeout may need verification]
**Warning signs:** Actions timing out at the Convex infrastructure level rather than at individual tier levels.

### Pitfall 5: Europe PMC Rate Limiting
**What goes wrong:** Europe PMC returns 429 Too Many Requests during burst processing of multiple papers with PMCIDs.
**Why it happens:** The workpool processes up to 5 papers in parallel. If many papers have PMCIDs, Europe PMC may rate-limit.
**How to avoid:** The workpool's `maxParallelism: 5` is conservative. Europe PMC has generous rate limits for non-authenticated access. The 20s fetch timeout naturally throttles requests. If 429s appear, the workpool retry with exponential backoff handles it. [ASSUMED -- exact Europe PMC rate limits not documented in their public API page]
**Warning signs:** Frequent PMC tier failures with 429 status codes.

### Pitfall 6: `convex.json` vs `convex.config.ts`
**What goes wrong:** Confusing `convex.json` (project-level config for Node runtime, bundling) with `convex.config.ts` (component registrations).
**Why it happens:** Both configure the Convex deployment but at different levels.
**How to avoid:** `convex.json` goes at project root, contains `node.nodeVersion` and `node.externalPackages`. `convex.config.ts` is in the `convex/` directory and registers components. They serve different purposes. [VERIFIED: Convex docs]
**Warning signs:** `unpdf` bundling errors or Node.js version mismatch in deployed actions.

### Pitfall 7: File Parts in AI SDK Require mediaType
**What goes wrong:** Sending a PDF to Gemini without specifying `mediaType: 'application/pdf'` causes the request to fail.
**Why it happens:** The AI SDK `file` content part requires an explicit `mediaType` string. It does not auto-detect from the data.
**How to avoid:** Always specify `mediaType: 'application/pdf'` when sending file parts. Pass the PDF data as `Uint8Array` or `Buffer`. [VERIFIED: AI SDK source code inspection -- `filePartSchema` requires `mediaType: z.string()`]
**Warning signs:** Gemini tier throwing type errors or API errors about invalid content.

## Code Examples

### PMC JATS XML Parsing
```typescript
// Source: fast-xml-parser Context7 docs + verified Europe PMC API endpoint
import { XMLParser } from "fast-xml-parser";

async function parsePmc(pmcId: string, signal: AbortSignal): Promise<string> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcId}/fullTextXML`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Europe PMC returned ${response.status} for ${pmcId}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: true,
    // Keep all text content, don't parse numbers
    parseTagValue: false,
  });
  const result = parser.parse(xml);

  // JATS structure: article > body > sec > p (text content)
  const body = result?.article?.body;
  if (!body) throw new Error("No <body> element in JATS XML");

  // Recursively extract text from nested sections
  return extractTextFromJatsBody(body);
}

function extractTextFromJatsBody(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractTextFromJatsBody).join(" ");
  if (typeof node === "object" && node !== null) {
    return Object.values(node).map(extractTextFromJatsBody).join(" ");
  }
  return String(node ?? "");
}
```

### arXiv HTML Parsing
```typescript
// Source: linkedom Context7 docs + verified arXiv HTML endpoint
import { parseHTML } from "linkedom";

async function parseArxiv(arxivId: string, signal: AbortSignal): Promise<string> {
  const url = `https://arxiv.org/html/${arxivId}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`arXiv HTML returned ${response.status} for ${arxivId}`);
  }

  const html = await response.text();
  const { document } = parseHTML(html);

  // arXiv HTML structure: main article content is in <article> or <main>
  const article = document.querySelector("article")
    ?? document.querySelector(".ltx_page_main")
    ?? document.querySelector("main");

  if (!article) throw new Error("No article element found in arXiv HTML");

  // Remove script, style, and nav elements
  for (const el of article.querySelectorAll("script, style, nav, .ltx_bibliography")) {
    el.remove();
  }

  const text = article.textContent?.trim() ?? "";
  if (text.length === 0) throw new Error("Empty text content from arXiv HTML");

  return text;
}
```

### unpdf Text Extraction with Page Count Guard
```typescript
// Source: unpdf Context7 docs
import { getDocumentProxy, extractText } from "unpdf";

async function parsePdfWithUnpdf(
  pdfUrl: string,
  signal: AbortSignal
): Promise<{ text: string; totalPages: number }> {
  // Fetch PDF with timeout
  const response = await fetch(pdfUrl, { signal });
  if (!response.ok) throw new Error(`PDF fetch returned ${response.status}`);

  const buffer = await response.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  // Page count guard (PARSE-10)
  if (pdf.numPages > 200) {
    throw new Error(`PDF has ${pdf.numPages} pages (max 200)`);
  }

  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: text as string, totalPages };
}
```

### Gemini-as-PDF-Parser via AI SDK
```typescript
// Source: AI SDK docs (prompts.mdx file parts) + @ai-sdk/google source code
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

async function parseWithGemini(
  pdfUrl: string,
  signal: AbortSignal
): Promise<string> {
  // Fetch PDF data first
  const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`PDF fetch returned ${response.status}`);
  const pdfData = new Uint8Array(await response.arrayBuffer());

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
```

### convex.json Configuration
```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "node": {
    "nodeVersion": "22",
    "externalPackages": ["unpdf"]
  }
}
```
[VERIFIED: Convex docs at docs.convex.dev/production/project-configuration -- `nodeVersion: "22"` and `externalPackages` are both supported]

### Schema Changes
```typescript
// convex/schema.ts -- extractionPapers table modification
extractionPapers: defineTable({
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("parsing"),
    v.literal("extracting"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),
  workpoolId: v.optional(v.string()),
  // Phase 90 additions:
  bodyText: v.optional(v.string()),
  parsingSource: v.optional(
    v.union(
      v.literal("pmc"),
      v.literal("arxiv"),
      v.literal("unpdf"),
      v.literal("gemini"),
      v.literal("abstract_only")
    )
  ),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"]),
```

## OpenAlex Metadata Resolution

### Critical Finding: PMCID Extraction Strategy

OpenAlex does NOT reliably include `pmcid` in the `ids` object for most papers. Through live API probing of multiple papers with known PMC availability, the `ids` object typically only contains `openalex`, `doi`, `mag`, and `pmid`. [VERIFIED: multiple API calls 2026-04-15]

**The reliable extraction path for PMCID:**
1. Check `ids.pmcid` (rare but sometimes present as a URL like `https://www.ncbi.nlm.nih.gov/pmc/articles/PMCxxxxxxx`)
2. Scan `locations[]` for entries where `source.display_name === "PubMed Central"`
3. Extract PMC number from `landing_page_url` (pattern: `/pmc/articles/XXXXXXX`) or `id` field (pattern: `pmh:oai:pubmedcentral.nih.gov:XXXXXXX`)
4. Prefix with `PMC` to form the PMCID for Europe PMC API

**The reliable extraction path for arXiv ID:**
1. Check `primary_location.landing_page_url` for `arxiv.org/abs/{id}` pattern
2. Scan `locations[]` for entries where `id` starts with `pmh:oai:arXiv.org:`
3. Check `ids.doi` for arXiv DOI pattern `10.48550/arxiv.{id}`

**The reliable extraction path for PDF URL:**
1. Check `best_oa_location.pdf_url` (most common)
2. Fall through `locations[]` looking for any entry with `is_oa: true` and a non-null `pdf_url`

### Europe PMC fullTextXML Endpoint

- **URL pattern:** `https://www.ebi.ac.uk/europepmc/webservices/rest/{PMCID}/fullTextXML` [VERIFIED: returns 200 with JATS XML for PMC7395209]
- **Response format:** JATS XML (NLM DTD v1.4 with MathML3)
- **Access:** No API key required, no authentication
- **Rate limits:** Not explicitly documented; generous for non-commercial use [ASSUMED]
- **JATS body structure:** `<article><body><sec><title>...</title><p>...</p></sec></body></article>`

### arXiv HTML Endpoint

- **URL pattern:** `https://arxiv.org/html/{arxivId}` [VERIFIED: returns 200 for `2402.08954`]
- **Coverage:** Experimental -- not all papers have HTML versions. Papers without HTML return 404. [VERIFIED: `2301.08766` returns 404]
- **HTML structure:** LaTeXML-generated HTML5. Article content in `<article>` or `.ltx_page_main` elements. [CITED: info.arxiv.org/about/accessible_HTML.html]
- **Version suffix:** Optional. Bare ID (e.g., `2402.08954`) works when HTML exists.

## Timeout Architecture

### AbortSignal.timeout in Node 22

`AbortSignal.timeout(ms)` is a static method available natively in Node.js 18+ (stable since Node 16.14). In Node 22, it is fully stable and requires no polyfills. [VERIFIED: Node.js docs]

The signal automatically aborts after the specified duration. When passed to `fetch()`, it cancels the underlying TCP connection. When passed to AI SDK's `generateText`, it cancels the HTTP request to the Gemini API.

### Timeout Budget Per Tier

| Tier | Operation | Timeout | Rationale |
|------|-----------|---------|-----------|
| OpenAlex metadata | HTTP fetch | 20s | External API, polite pool |
| PMC JATS | HTTP fetch + XML parse | 30s | XML download + parse; typical size 50-200KB |
| arXiv HTML | HTTP fetch + DOM parse | 30s | HTML download + parse; typical size 100-500KB |
| unpdf | HTTP fetch + PDF parse | 60s | Binary download + text extraction; PDFs can be 10MB+ |
| Gemini | HTTP fetch + LLM call | 120s | File upload + model processing; depends on PDF size |

### withTimeout Implementation Note

The `withTimeout` wrapper should accept a function that receives the `AbortSignal`, allowing it to be passed to `fetch`, `generateText`, or any other abort-aware API. This is more powerful than `Promise.race` because it actually cancels the underlying operation rather than just abandoning the promise.

```typescript
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return fn(signal);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pdfjs-dist/legacy` with Canvas polyfills | `unpdf` (serverless PDF.js v5) | 2024 | No native deps, serverless-ready |
| Docling/MinerU Python sidecars for PDF parsing | Gemini-as-PDF-parser via AI SDK `filePart` | 2025 | Zero infrastructure, ~$0.0005/paper, handles scanned PDFs |
| GROBID for bibliographic extraction | OpenAlex metadata API | N/A | Free, instant, covers 250M+ works |
| Custom XML parsers for PMC JATS | `fast-xml-parser` v5+ | 2024 | Faster, supports JATS namespaces, zero C++ deps |
| JSDOM for server-side HTML parsing | `linkedom` | 2023 | 10x lighter, no Canvas dep, optimized for serverless |
| `convex.json` `node.externalPackages: ["*"]` | Targeted external packages | Current | Only mark packages that need it (e.g., `unpdf` with native bindings) |

**Deprecated/outdated:**
- `pdfjs-dist/legacy/build/pdf.mjs`: Replaced by `unpdf` per project out-of-scope decisions
- OpenAlex `/ngrams` endpoint: Retired by OpenAlex, no body text returned
- `xml2js`: Abandoned; `fast-xml-parser` is faster and actively maintained

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Convex action timeout is sufficient for the worst case (multiple tier timeouts) | Pitfall 4 | Action may fail at infrastructure level before completing the waterfall; need to verify Convex action timeout limit |
| A2 | Europe PMC rate limits are generous enough for maxParallelism: 5 | Pitfall 5 | May need request-level throttling or exponential backoff within the PMC tier |
| A3 | `unpdf` works correctly as a Convex external package with Node 22 | convex.json Configuration | May need additional bundling configuration or alternative PDF library |
| A4 | Gemini 2.5 Flash Lite supports `filePart` with `MEDIA_RESOLUTION_LOW` for PDFs | Gemini Tier | May need a different model or different provider options; verify before implementation |

## Open Questions (RESOLVED)

1. **Convex Action Timeout Limit** — RESOLVED
   - What we know: Convex actions have a max execution time. Workpool retries handle transient failures.
   - What's unclear: The exact timeout limit for Convex actions (likely 10-15 minutes based on typical serverless limits).
   - Recommendation: The tier timeouts (20+30+60+120 = 230s worst case) should be well within any reasonable action timeout. If a paper hits all 4 tiers sequentially, it takes ~4 minutes worst case. Low risk.
   - **RESOLVED:** Accepted as low risk. Convex action timeout is 10 minutes for Node.js actions. Worst-case waterfall (230s) is well under this limit. Workpool retries handle transient timeouts.

2. **Google API Key for `@ai-sdk/google`** — RESOLVED
   - What we know: `@ai-sdk/google` is already installed. The `createGoogleGenerativeAI()` function reads `GOOGLE_GENERATIVE_AI_API_KEY` from env by default.
   - What's unclear: Whether this env var is already configured in Convex deployment.
   - Recommendation: Verify `GOOGLE_GENERATIVE_AI_API_KEY` is set in Convex environment. If not, add it as part of Phase 90 setup.
   - **RESOLVED:** Executor must verify env var is set in Convex deployment during Plan 02 execution. If missing, the Gemini tier will fail gracefully and fall through to abstract_only. Not a blocker for planning.

3. **JATS XML Body Text Extraction Depth** — RESOLVED
   - What we know: JATS XML has deeply nested elements (`<sec>`, `<p>`, `<fig>`, `<table-wrap>`, `<xref>`, `<ext-link>`, etc.).
   - What's unclear: How much structure to preserve vs. flatten to plain text.
   - Recommendation: For MVP, recursively extract all text content. Do not attempt to preserve structure (headers, tables, figure captions). This is sufficient for whole-paper LLM extraction.
   - **RESOLVED:** Recursive text flattening adopted in Plan 02 Task 1 via extractTextFromJatsBody helper. Structure preservation deferred — flat text is sufficient for LLM extraction in Phase 91.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | `unpdf`, `AbortSignal.timeout` | Yes | v22.22.0 | -- |
| Convex CLI | Deployment | Yes | v1.35.1 | -- |
| `fast-xml-parser` | PMC JATS parsing | No (to install) | 5.5.12 (npm) | -- |
| `linkedom` | arXiv HTML parsing | No (to install) | 0.18.12 (npm) | -- |
| `unpdf` | PDF text extraction | No (to install) | 1.6.0 (npm) | -- |
| `@ai-sdk/google` | Gemini PDF parser | Yes | 3.0.18 (installed) | -- |
| `ai` | AI SDK core | Yes | 6.0.62 (installed) | -- |
| Europe PMC API | PMC tier | Yes (public) | -- | -- |
| arXiv HTML | arXiv tier | Yes (public, experimental) | -- | Falls through to PDF tier |
| `OPENALEX_CONTACT_EMAIL` env var | Polite pool access | Yes (existing) | -- | -- |
| `GOOGLE_GENERATIVE_AI_API_KEY` env var | Gemini tier | Unknown | -- | Must verify/add |

**Missing dependencies with no fallback:**
- `fast-xml-parser`, `linkedom`, `unpdf`: Must be installed via `npm install`

**Missing dependencies with fallback:**
- None -- all external services have tier fallthrough built into the waterfall

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + convex-test 0.0.46 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run convex/extraction/ tests/extraction/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PARSE-01 | OpenAlex metadata fetch + field extraction | unit | `npx vitest run tests/extraction/parse.test.ts -t "metadata"` | No -- Wave 0 |
| PARSE-02 | PMC JATS XML -> body text | unit (fixture) | `npx vitest run tests/extraction/parse.test.ts -t "pmc"` | No -- Wave 0 |
| PARSE-03 | arXiv HTML -> body text | unit (fixture) | `npx vitest run tests/extraction/parse.test.ts -t "arxiv"` | No -- Wave 0 |
| PARSE-04 | unpdf PDF -> body text | unit (fixture) | `npx vitest run tests/extraction/parse.test.ts -t "unpdf"` | No -- Wave 0 |
| PARSE-05 | Gemini fallback on unpdf < 1500 chars | unit (mock) | `npx vitest run tests/extraction/parse.test.ts -t "gemini"` | No -- Wave 0 |
| PARSE-06 | abstract_only fallback | unit | `npx vitest run tests/extraction/parse.test.ts -t "abstract"` | No -- Wave 0 |
| PARSE-07 | parsingSource stored on paper row | integration | `npx vitest run convex/extraction/mutations.test.ts -t "parsing"` | No -- Wave 0 |
| PARSE-08 | Node 22 + convex.json config | manual | Verify `convex.json` content | No -- Wave 0 |
| PARSE-09 | AbortSignal.timeout per tier | unit | `npx vitest run tests/extraction/parse.test.ts -t "timeout"` | No -- Wave 0 |
| PARSE-10 | 200-page PDF rejection | unit | `npx vitest run tests/extraction/parse.test.ts -t "page cap"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/extraction/parse.test.ts convex/extraction/mutations.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/extraction/parse.test.ts` -- covers PARSE-01 through PARSE-06, PARSE-09, PARSE-10
- [ ] `tests/extraction/fixtures/` -- directory for PMC XML snippet, arXiv HTML snippet, small PDF fixture
- [ ] Framework install: `npm install fast-xml-parser linkedom unpdf` -- new dependencies

**Test fixture strategy (Claude's discretion):** Recommend small, real-world snippets for PMC XML and arXiv HTML (captured from actual Europe PMC and arXiv responses, trimmed to essential elements). For PDF fixtures, use a tiny synthetic PDF generated via a test helper or committed as a binary fixture. Mock `fetch` for network isolation in unit tests.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Actions run in workpool context (no user auth needed) |
| V3 Session Management | No | Server-side only |
| V4 Access Control | Yes (job isolation) | Job ownership verified in mutations (existing Phase 89 pattern) |
| V5 Input Validation | Yes | Validate OpenAlex response shape, PDF size limits, page count cap |
| V6 Cryptography | No | No secret handling in parse tier |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via OpenAlex `pdf_url` | Tampering | Validate URL scheme is `https://`, reject non-http(s) schemes; `fetch` with `AbortSignal.timeout` prevents hanging connections |
| PDF bomb (decompression bomb) | Denial of Service | 200-page cap (PARSE-10); timeout on unpdf (60s); Convex action timeout as ultimate backstop |
| XML External Entity (XXE) | Information Disclosure | `fast-xml-parser` does not process external entities by default -- safe out of the box [VERIFIED: Context7 docs] |
| Prompt injection via PDF text | Tampering | Not this phase's concern -- mitigated in Phase 92 (CRASH-05) via UUID delimiters |
| Memory exhaustion from large PDFs | Denial of Service | Fetch timeout (20s), page count guard (200 pages), unpdf timeout (60s) |

## Sources

### Primary (HIGH confidence)
- npm registry -- package versions for `fast-xml-parser` (5.5.12), `linkedom` (0.18.12), `unpdf` (1.6.0) [VERIFIED: 2026-04-15]
- Context7 `/naturalintelligence/fast-xml-parser` -- XMLParser API, options, usage patterns
- Context7 `/webreflection/linkedom` -- parseHTML, querySelector, textContent API
- Context7 `/unjs/unpdf` -- getDocumentProxy, extractText, serverless usage patterns
- `@ai-sdk/google` source code (`node_modules/@ai-sdk/google/src/`) -- `mediaResolution` enum values, file part handling
- AI SDK docs (`node_modules/ai/docs/02-foundations/03-prompts.mdx`) -- file part usage with `type: 'file'`, `mediaType`, `data`
- Convex docs (`docs.convex.dev/production/project-configuration`) -- `convex.json` `nodeVersion` and `externalPackages` configuration
- Convex AI guidelines (`convex/_generated/ai/guidelines.md`) -- action patterns, schema guidelines
- Live OpenAlex API probing -- verified `ids`, `locations`, `best_oa_location` structure across multiple works
- Live Europe PMC API probing -- verified `fullTextXML` endpoint returns JATS XML for PMC7395209
- Live arXiv endpoint probing -- verified `arxiv.org/html/{id}` returns 200/404 depending on HTML availability

### Secondary (MEDIUM confidence)
- [Europe PMC REST API documentation](https://europepmc.org/RestfulWebService) -- endpoint patterns
- [arXiv accessible HTML documentation](https://info.arxiv.org/about/accessible_HTML.html) -- coverage, experimental status
- [Convex project configuration docs](https://docs.convex.dev/production/project-configuration) -- convex.json schema
- [OpenAlex Work object documentation](https://developers.openalex.org/api-entities/works/work-object) -- ids, locations fields

### Tertiary (LOW confidence)
- Europe PMC rate limits -- not explicitly documented in public API docs [ASSUMED: generous for non-commercial use]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified on npm, APIs confirmed via Context7 and source code
- Architecture: HIGH -- waterfall pattern well-understood, all endpoints verified live
- Pitfalls: HIGH -- identified through live API probing (PMCID extraction, arXiv 404s)
- OpenAlex metadata extraction: HIGH -- verified against live API responses with multiple papers

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable libraries and APIs, no fast-moving targets)
