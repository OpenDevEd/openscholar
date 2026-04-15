---
phase: 90-free-first-parsing-waterfall
plan: 03
subsystem: extraction-parsing
tags: [tests, vitest, parsing, waterfall, mocking]
dependency_graph:
  requires:
    - parseFullText function (from 90-02)
    - ParseResult type (from 90-02)
    - ParsingSource type (from 90-02)
    - reconstructAbstract utility
  provides:
    - Unit test coverage for all 5 parsing tiers
    - Regression guard for waterfall logic
    - Test patterns for mocking fetch, unpdf, AI SDK
  affects:
    - tests/extraction/parse.test.ts
tech_stack:
  added: []
  patterns:
    - vi.mock() module-level mocking for unpdf, ai, @ai-sdk/google
    - globalThis.fetch assignment for per-test fetch interception
    - Factory helpers for mock OpenAlex API responses
    - Lazy mockFetchResponse with deferred JSON.parse (avoids eager parse of XML/HTML)
key_files:
  created:
    - tests/extraction/parse.test.ts
  modified: []
decisions:
  - "Lazy JSON parsing in mockFetchResponse -- defers JSON.parse to .json() call time to avoid SyntaxError on XML/HTML bodies"
  - "17 tests across 8 describe blocks (exceeds 14-test minimum) for comprehensive tier coverage"
  - "Tests run in Node.js environment (tests/ directory) per vitest.config.ts, matching parse.ts Node-only deps"
metrics:
  duration: 3m 12s
  completed: "2026-04-15T02:19:37Z"
  tasks: 1/1
  files_changed: 1
---

# Phase 90 Plan 03: Parsing Waterfall Test Suite Summary

17-test vitest suite covering all 5 parsing tiers (PMC JATS XML, arXiv HTML, unpdf PDF, Gemini-as-PDF-parser, abstract-only fallback), OpenAlex metadata resolution (PMCID from ids/locations, arXiv from landing URL/DOI), timeout signal propagation, 200-page PDF cap with early extractText rejection, and 1500-char unpdf-to-Gemini threshold.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Create parse.test.ts with mocked tiers, timeout, and page cap tests | 3e3e4c1 | 730-line test file with 17 tests across 8 describe blocks |

## Key Files

### Created
- `tests/extraction/parse.test.ts` -- 17 tests in 8 describe blocks: OpenAlex metadata resolution (4 tests), PMC JATS XML tier (2 tests), arXiv HTML tier (2 tests), unpdf PDF tier (3 tests), Gemini PDF parser tier (1 test), abstract_only fallback (2 tests), timeout ceilings (2 tests), 200-page PDF cap (1 test).

## Decisions Made

1. **Lazy JSON parsing in mockFetchResponse** -- The mock fetch response factory initially called `JSON.parse()` eagerly during construction, causing SyntaxError when the body was XML or HTML. Changed to lazy `.mockImplementation()` that defers JSON.parse to actual `.json()` call time with try/catch fallback.
2. **17 tests exceed 14-test minimum** -- Added extra coverage for locations-array PMCID extraction, arXiv DOI pattern extraction, and separate nav/script removal verification in arXiv tier.
3. **Node.js test environment** -- Tests placed in `tests/extraction/` (not `convex/`) to use the Node.js environment per `vitest.config.ts` `environmentMatchGlobs` rules. This is correct because `parse.ts` imports Node-only packages (fast-xml-parser, linkedom, unpdf).

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- `npx vitest run tests/extraction/parse.test.ts` -- 17/17 tests pass
- `grep -c "it(" tests/extraction/parse.test.ts` -- 17 tests (exceeds minimum of 14)
- All 5 parsingSource values tested: pmc, arxiv, unpdf, gemini, abstract_only
- `npx tsc --noEmit` -- zero new errors (only pre-existing errors in mutations.test.ts and handleExtractionComplete workpool handler, unrelated to this plan)
- PMCID from locations array test present (test: "extracts PMCID from locations array when ids.pmcid absent")
- 200-page rejection test verifies extractText NOT called (test: "rejects PDF exceeding 200 pages before extraction")
- 1500-char Gemini threshold test present (test: "falls through to Gemini when unpdf returns <1500 chars")
- Timeout signal verification tests verify AbortSignal instances passed to fetch calls

## Self-Check: PASSED

- tests/extraction/parse.test.ts: FOUND
- 90-03-SUMMARY.md: FOUND
- Commit 3e3e4c1: FOUND
