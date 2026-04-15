# Phase 90: Free-First Parsing Waterfall - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Given a paper with an OpenAlex record, retrieve body text through the cheapest upstream source possible — PMC JATS → arXiv HTML → unpdf → Gemini-as-PDF-parser → abstract-only — with hard abort-signal ceilings, a 200-page cap, and a per-paper `parsing_source` tag surfaced to the UI. This phase fills the `processExtractionPaper` workpool action stub from Phase 89 with real parsing logic.

</domain>

<decisions>
## Implementation Decisions

### Parsing Module Architecture
- **D-01:** Waterfall parsing logic lives in a separate `convex/extraction/parse.ts` module, NOT inlined in `workpoolActions.ts`. The workpool action calls `parseFullText(paper)` and stores the result. This keeps the waterfall independently testable and the action handler thin.
- **D-02:** `parse.ts` exports a single `parseFullText` function that takes paper metadata (DOI, OpenAlex IDs) and returns `{ bodyText: string, parsingSource: ParsingSource }` or throws on total failure.
- **D-03:** Each parsing tier (PMC, arXiv, unpdf, Gemini) is a separate internal function within `parse.ts` — not separate files. The waterfall is a linear try/catch chain in `parseFullText`.

### OpenAlex Metadata Resolution
- **D-04:** The parsing pipeline fetches fresh OpenAlex metadata at parse time using the DOI stored on the `extractionPapers` row. This ensures the parser sees the latest `best_oa_location`, `ids.pmcid`, and arXiv ID availability.
- **D-05:** OpenAlex metadata fetch uses the existing `OPENALEX_CONTACT_EMAIL` env var for polite pool access, following the pattern in `convex/library/backfill.ts`.
- **D-06:** arXiv ID extraction: parse from `ids.openalex` URL path or `primary_location.landing_page_url` matching `arxiv.org/abs/{id}` pattern.

### Body Text Storage
- **D-07:** Parsed full text is stored directly as a `bodyText` field on the `extractionPapers` row. Convex documents support up to ~1MB, and academic paper text typically falls well under 500KB. This avoids file storage complexity.
- **D-08:** `extractionPapers` schema gets two new fields: `bodyText: v.optional(v.string())` and `parsingSource: v.optional(v.union(v.literal("pmc"), v.literal("arxiv"), v.literal("unpdf"), v.literal("gemini"), v.literal("abstract_only")))`. Both optional because they're populated after the parsing step runs.

### Gemini-as-PDF-Parser Provider
- **D-09:** Gemini-as-PDF-parser uses `@ai-sdk/google` directly (NOT OpenRouter). OpenRouter does not support the `filePart` API needed for `media_resolution: 'low'` PDF parsing. The Google AI SDK talks to Gemini natively for this single use case.
- **D-10:** Model for PDF parsing: Gemini 2.5 Flash Lite (cheapest available). Temperature: 0. Prompt: "Extract all text from this document. Return only the document text, no commentary."

### Abort Signal Ceilings
- **D-11:** Each tier gets a hard `AbortSignal.timeout` ceiling per PARSE-09: fetch operations = 20s, XML parse operations = 30s, unpdf = 60s, Gemini = 120s. On timeout, the tier throws and the waterfall falls through to the next tier.
- **D-12:** A shared `withTimeout(fn, ms)` utility wraps each tier call. This is a thin wrapper, not an abstraction — it creates the AbortSignal and passes it through.

### PDF Page Cap
- **D-13:** Before invoking `unpdf` or Gemini-as-PDF-parser, check page count. PDFs with >200 pages are rejected and the paper falls through to `abstract_only`. Page count is read from PDF metadata via `unpdf` utilities without fully parsing the document.

### Dependencies
- **D-14:** Install `fast-xml-parser` for PMC JATS XML parsing, `linkedom` for arXiv HTML DOM parsing, and `unpdf` for serverless PDF text extraction. These are the ONLY new dependencies.
- **D-15:** Create `convex.json` at project root with `{ "node": { "externalPackages": ["unpdf"] } }` — this ensures `unpdf` runs correctly in Convex's Node.js actions. Node 22 is already pinned in CI.

### Claude's Discretion
- Error message format for each tier's failure logging — follow the structured JSON pattern from REQUIREMENTS OBS-01 when it's available (Phase 95), otherwise use simple `console.warn`.
- Whether to cache OpenAlex metadata response for the duration of the job (skip re-fetching for the same paper) — depends on whether a paper could appear in multiple jobs simultaneously.
- The exact prompt text for Gemini-as-PDF-parser beyond the core instruction.
- Test fixture design: real XML/HTML snippets vs synthetic fixtures.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` — Current extraction tables from Phase 89. `extractionPapers` needs `bodyText` and `parsingSource` fields added.
- `convex/extraction/validators.ts` — Existing validators for extraction status unions and shapes.

### Extraction Skeleton (Phase 89 output)
- `convex/extraction/workpoolActions.ts` — Stub `processExtractionPaper` action that Phase 90 fills with parsing logic.
- `convex/extraction/workflow.ts` — Durable workflow that orchestrates parse → extract → critic → persist stages.
- `convex/extraction/mutations.ts` — `enqueueAllPapers`, `saveResult`, `finalizeJobIfDone` mutations.

### Existing Patterns
- `convex/screening/workpoolActions.ts` — Proven workpool action pattern with terminal-status guard, idempotency guard, error handling, and `"use node"` directive.
- `convex/library/backfill.ts` — OpenAlex API fetch pattern with `fetch()` to `api.openalex.org/works/{id}?mailto=`.
- `lib/openalex/reconstruct-abstract.ts` — Abstract reconstruction from inverted index format.
- `lib/openalex.ts` — OpenAlex SDK client instance.

### Configuration
- `convex/convex.config.ts` — Component registrations. `extractionWorkpool` already registered.
- `convex/workpool.ts` — `extractionPool` instance with `maxParallelism: 5`.
- `convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB = 200`.

### Requirements
- `.planning/REQUIREMENTS.md` — PARSE-01 through PARSE-10 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/extraction/workpoolActions.ts` — Stub ready to be filled with parsing pipeline call.
- `convex/library/backfill.ts` — OpenAlex direct fetch pattern (lines showing `fetch(`https://api.openalex.org/works/${workId}?mailto=...`)`).
- `lib/openalex/reconstruct-abstract.ts` — Inverted index → plain text function for abstract-only fallback.
- `@ai-sdk/google` (v3.0.18) — Already installed, used for Gemini-as-PDF-parser.
- `ai` (v6.0.62) — Vercel AI SDK core already installed.

### Established Patterns
- `"use node"` directive on Convex actions needing Node.js APIs (18 files use this).
- Terminal-status guard in workpool actions: check `job.status` before proceeding.
- Idempotency guard: check if work already done before re-executing.
- `OPENALEX_CONTACT_EMAIL` env var for polite pool API access.

### Integration Points
- `convex/extraction/workpoolActions.ts` — Parse pipeline is called from here.
- `convex/schema.ts` — New fields added to `extractionPapers` table.
- `convex/extraction/validators.ts` — New `parsingSource` validator added here.
- `package.json` — New dependencies: `fast-xml-parser`, `linkedom`, `unpdf`.
- `convex.json` — New file for Node.js runtime configuration.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md PARSE-01 through PARSE-10 are precise. The waterfall order (PMC → arXiv → unpdf → Gemini → abstract) and the abort-signal ceilings (20s/30s/60s/120s) are locked in requirements.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 90-free-first-parsing-waterfall*
*Context gathered: 2026-04-15*
