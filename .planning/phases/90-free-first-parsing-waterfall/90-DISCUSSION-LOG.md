# Phase 90: Free-First Parsing Waterfall - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 90-free-first-parsing-waterfall
**Areas discussed:** Parsing module location, OpenAlex metadata resolution, Body text storage, Gemini provider selection
**Mode:** --auto (all decisions auto-resolved with recommended defaults)

---

## Parsing Module Location

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `convex/extraction/parse.ts` module | Keeps workpoolActions thin, waterfall is testable independently | ✓ |
| Inline in `workpoolActions.ts` | All parsing logic inside the action handler | |
| Multiple files per tier | Separate file for each parsing tier (pmcParser.ts, arxivParser.ts, etc.) | |

**User's choice:** [auto] Separate `convex/extraction/parse.ts` module (recommended default)
**Notes:** Follows the established pattern of keeping action handlers thin with business logic in dedicated modules. Each tier is an internal function within parse.ts, not a separate file — the waterfall is a single linear flow.

---

## OpenAlex Metadata Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch fresh at parse time using stored DOI | Gets latest `best_oa_location`, `ids.pmcid`, arXiv ID | ✓ |
| Store all IDs at job creation | Pre-resolve all identifiers when the job is created | |
| Use OpenAlex SDK client | Route through `@sickrin/openalex-sdk` instead of direct fetch | |

**User's choice:** [auto] Fetch fresh at parse time using stored DOI (recommended default)
**Notes:** DOI is already stored on extractionPapers from Phase 89. Fresh fetch ensures the parser sees the latest availability data from OpenAlex. Follows the existing backfill.ts pattern for direct API calls.

---

## Body Text Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Store on `extractionPapers` row | Direct field on the paper document, up to ~1MB | ✓ |
| Convex file storage | Upload to file storage, store reference ID | |
| Separate `extractionTexts` table | Dedicated table for large text blobs | |

**User's choice:** [auto] Store on `extractionPapers` row (recommended default)
**Notes:** Convex documents support up to ~1MB. Academic paper text typically falls well under 500KB. Avoids file storage complexity and keeps the data co-located with the paper metadata for simple queries.

---

## Gemini Provider Selection

| Option | Description | Selected |
|--------|-------------|----------|
| `@ai-sdk/google` directly | Native Google AI SDK, supports `filePart` with `media_resolution` | ✓ |
| `@openrouter/ai-sdk-provider` | Route through OpenRouter for consistency with extraction cascade | |

**User's choice:** [auto] `@ai-sdk/google` directly (recommended default)
**Notes:** OpenRouter does not support the `filePart` API needed for `media_resolution: 'low'` PDF parsing. The Google AI SDK talks to Gemini natively. This is the only use case that bypasses OpenRouter — the extraction cascade (Phase 91) uses OpenRouter for all LLM calls.

---

## Claude's Discretion

- Error message format for tier failures
- OpenAlex metadata caching strategy within a job
- Exact Gemini PDF parser prompt text
- Test fixture design (real vs synthetic)

## Deferred Ideas

None — discussion stayed within phase scope.
