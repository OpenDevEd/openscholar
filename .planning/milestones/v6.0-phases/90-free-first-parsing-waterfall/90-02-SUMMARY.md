---
phase: 90-free-first-parsing-waterfall
plan: 02
subsystem: extraction-parsing
tags: [parsing, waterfall, pmc, arxiv, unpdf, gemini, workpool, action]
dependency_graph:
  requires:
    - parsingSourceValidator
    - extractionPaperStatusValidator
    - storeParsedText mutation
    - updatePaperStatus mutation
    - reconstructAbstract utility
  provides:
    - parseFullText function
    - ParseResult type
    - ParsingSource type
    - getPaperInternal query
    - processExtractionPaper action (live implementation)
  affects:
    - convex/extraction/workpoolActions.ts
    - convex/extraction/queries.ts
tech_stack:
  added: []
  patterns:
    - Multi-tier waterfall with linear try/catch fallthrough
    - withTimeout utility wrapping AbortSignal.timeout for tier ceilings
    - Pure async module (no Convex registrations) imported by "use node" action
    - Terminal-status and idempotency guards in workpool action (mirrors screening pattern)
key_files:
  created:
    - convex/extraction/parse.ts
  modified:
    - convex/extraction/workpoolActions.ts
    - convex/extraction/queries.ts
decisions:
  - "fetchOpenAlexMetadata accepts signal parameter from withTimeout rather than creating its own AbortSignal (cleaner signal propagation)"
  - "getPaperInternal returns bodyText and parsingSource fields for idempotency check and downstream access"
  - "Paper variable named 'paper' (not 'papers' as in plan spec) for clarity since it is a single document"
metrics:
  duration: 5m 5s
  completed: "2026-04-15T02:13:15Z"
  tasks: 2/2
  files_changed: 3
---

# Phase 90 Plan 02: Core Parsing Waterfall and Workpool Wiring Summary

478-line parse.ts module with 5-tier waterfall (PMC JATS via Europe PMC, arXiv HTML via linkedom, unpdf local PDF extraction, Gemini-as-PDF-parser via @ai-sdk/google with MEDIA_RESOLUTION_LOW, abstract-only fallback), each tier wrapped in withTimeout with AbortSignal.timeout ceilings (20s/30s/60s/120s), 200-page PDF cap, 1500-char unpdf-to-Gemini threshold; workpool action wired with terminal-status guard, idempotency guard, storeParsedText storage, and error re-throw for retry.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Create parse.ts with waterfall, all tier functions, and withTimeout | 1e29cc9 | 478-line module: parseFullText, 5 tier functions, withTimeout, ID extraction helpers |
| 2 | Wire workpool action to call parseFullText, add getPaperInternal query | 277d6c4 | processExtractionPaper handler, getPaperInternal internalQuery |

## Key Files

### Created
- `convex/extraction/parse.ts` -- Pure async module exporting `parseFullText(doi, openalexId)`. Contains 5 tier functions (parsePmc, parseArxiv, parsePdfWithUnpdf, parseWithGemini, abstract-only), 3 ID extraction helpers (extractPmcId, extractArxivId, extractPdfUrl), OpenAlex metadata fetcher, withTimeout utility, and JATS body text extractor. No Convex function registrations, no "use node" directive.

### Modified
- `convex/extraction/workpoolActions.ts` -- Replaced Phase 89 stub with live handler: terminal-status guard (completed/cancelled/failed), idempotency guard (bodyText check), marks paper "parsing", calls parseFullText, stores result via storeParsedText, error re-throw for workpool retry.
- `convex/extraction/queries.ts` -- Added `getPaperInternal` internalQuery returning paper with bodyText, parsingSource, doi, openalexId, status fields. Added imports for parsingSourceValidator and extractionPaperStatusValidator.

## Decisions Made

1. **Signal propagation in fetchOpenAlexMetadata** -- Instead of creating an independent `AbortSignal.timeout(20_000)` inside the function, it now accepts the signal from `withTimeout` as a parameter. This ensures clean cancellation propagation.
2. **getPaperInternal return shape** -- Returns bodyText and parsingSource as optional fields, matching the schema. This enables the idempotency guard (check if bodyText already exists) and supports future phases that need parsing metadata.
3. **Variable naming** -- Used `paper` (singular) instead of `papers` (plural from plan spec) for the single-document query result, since it returns one paper not a collection.

## Deviations from Plan

None -- plan executed exactly as written. Minor naming adjustment (paper vs papers) is cosmetic only.

## Verification Results

- parse.ts exports parseFullText with all 5 tiers in waterfall order
- parse.ts exports ParsingSource type and ParseResult interface
- withTimeout utility wraps AbortSignal.timeout with configurable ms ceiling
- 5 withTimeout calls with values: 20_000 (metadata), 30_000 (PMC), 30_000 (arXiv), 60_000 (unpdf), 120_000 (Gemini)
- extractPmcId checks ids.pmcid, locations array (PubMed Central source), and pubmedcentral.nih.gov prefix
- extractArxivId checks primary_location.landing_page_url, locations array (pmh:oai:arXiv.org), and DOI pattern
- parsePmc uses europepmc.webservices.rest URL with XMLParser
- parseArxiv uses arxiv.org/html URL with parseHTML from linkedom
- parsePdfWithUnpdf has pdf.numPages > 200 guard
- parseWithGemini uses gemini-2.5-flash-lite, mediaType: "application/pdf", MEDIA_RESOLUTION_LOW
- parse.ts has no "use node" directive, no Convex function registrations
- parse.ts has 4 console.warn calls for tier failure logging
- parse.ts is 478 lines (min_lines: 150 satisfied)
- workpoolActions.ts imports parseFullText from ./parse and internal from ../_generated/api
- workpoolActions.ts has terminal-status guard, idempotency guard, updatePaperStatus "parsing", storeParsedText, error re-throw
- queries.ts exports getPaperInternal with bodyText and parsingSource in return type
- queries.ts imports parsingSourceValidator and extractionPaperStatusValidator
- TypeScript compilation: zero new errors (only pre-existing errors in mutations.test.ts and handleExtractionComplete)

## Self-Check: PASSED

- convex/extraction/parse.ts: FOUND
- convex/extraction/workpoolActions.ts: FOUND
- convex/extraction/queries.ts: FOUND
- Commit 1e29cc9: FOUND
- Commit 277d6c4: FOUND
- SUMMARY.md: FOUND
