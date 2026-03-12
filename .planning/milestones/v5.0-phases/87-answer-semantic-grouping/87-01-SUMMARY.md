---
phase: 87-answer-semantic-grouping
plan: "01"
subsystem: ui
tags: [vitest, tdd, pure-functions, answer-grouping, semantic-synonyms]

# Dependency graph
requires:
  - phase: 85-bar-visualization
    provides: BarVisualization component and CitationStatusMix type used downstream
  - phase: 83-test-foundation-i18n-keys
    provides: vitest infrastructure and test patterns
provides:
  - buildSynonymMap pure function (static boolean/null synonym lookup)
  - groupAnswersBySynonym pure function (groups AnswerBucket inputs by synonym key)
  - mergeDisagreementClusters pure function (synonym-merges DisagreementCluster arrays)
  - SynonymMap and GroupedAnswer types
affects:
  - 87-02 (InsightsQuestionPanel integration — consumes these functions)
  - 87-03 (GroupedAnswerRow component — receives GroupedAnswer[] from groupAnswersBySynonym)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED→GREEN for pure utility functions: test file committed first (all fail), then implementation (all pass)"
    - "AnswerBucketInput interface accepts optional citationStatusMix to avoid type cast at call site"
    - "emptyMix() helper returns fresh CitationStatusMix to avoid shared-reference mutation"

key-files:
  created:
    - lib/extraction/answer-grouping.ts
    - tests/answer-grouping.test.ts
  modified: []

key-decisions:
  - "groupAnswersBySynonym uses normalized key for grouping (not display), matching CONTEXT.md locked decision"
  - "mergeDisagreementClusters concatenates ALL examples from merged clusters (not capped at 5) — callers may cap if needed"
  - "AnswerBucketInput defined inline in answer-grouping.ts rather than importing AnswerBucket from insights.ts — avoids coupling to citationStatusMix absence in AnswerBucket type"

patterns-established:
  - "Synonym grouping applied only to rawAnswerDistribution (scalar answers); entityDistribution is excluded — callers are responsible for this distinction"

requirements-completed: [GROUP-01, GROUP-03, GROUP-04]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 87 Plan 01: Answer Grouping Pure Utilities Summary

**Three pure TDD-tested utility functions for semantic answer grouping: static synonym map (yes/no/n-a), count-aggregating groupAnswersBySynonym, and synonym-merging mergeDisagreementClusters**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-10T10:46:02Z
- **Completed:** 2026-03-10T10:47:52Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 2

## Accomplishments
- `buildSynonymMap()` — static lookup table mapping boolean synonyms (yes/true/positive/affirmative → "yes"; no/false/negative/incorrect → "no") and null-like synonyms (n/a, unknown, none, not available, etc. → "n/a")
- `groupAnswersBySynonym()` — groups AnswerBucket inputs by synonym resolution key, aggregates total count and citationStatusMix across all variants, selects highest-count variant as representative, sorts groups and variants descending by count
- `mergeDisagreementClusters()` — synonym-aware merge of DisagreementCluster arrays with weighted-average confidence, summed citationStatusMix, concatenated examples from all clusters
- 28 tests passing covering all GROUP-01, GROUP-03, GROUP-04 behaviors

## Task Commits

Each task was committed atomically:

1. **RED — Failing tests** - `d0d9194` (test)
2. **GREEN — Implementation** - `1640406` (feat)

_TDD plan: RED commit before GREEN commit, both verified via `npm test -- tests/answer-grouping.test.ts --run`_

## Files Created/Modified
- `lib/extraction/answer-grouping.ts` — Three pure exported functions plus SynonymMap and GroupedAnswer types
- `tests/answer-grouping.test.ts` — 28 tests across buildSynonymMap, groupAnswersBySynonym, mergeDisagreementClusters

## Decisions Made
- `groupAnswersBySynonym` uses `normalized` key for grouping (not `display`) per CONTEXT.md locked decision
- `mergeDisagreementClusters` concatenates ALL examples (not capped at 5); callers can cap if needed
- Defined `AnswerBucketInput` inline rather than importing `AnswerBucket` to avoid awkward optional cast for `citationStatusMix` field that exists at runtime but not in the type definition

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- All three pure functions are exported and fully tested
- Plan 02 (InsightsQuestionPanel integration) can import directly from `lib/extraction/answer-grouping`
- Plan 03 (GroupedAnswerRow component) receives `GroupedAnswer[]` from `groupAnswersBySynonym`

---
*Phase: 87-answer-semantic-grouping*
*Completed: 2026-03-10*
