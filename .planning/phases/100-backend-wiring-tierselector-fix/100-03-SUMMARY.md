---
phase: 100-backend-wiring-tierselector-fix
plan: 03
subsystem: api
tags: [convex, openalex, fetch, batch-resolution, doi-lookup]

# Dependency graph
requires:
  - phase: none
    provides: normalizeOpenAlexId from lib/openalex/normalize.ts (pre-existing)
provides:
  - resolveManualIds Convex action (batch OpenAlex ID validation via pipe-delimited filter)
  - resolveByDoi Convex action (single DOI-to-OpenAlex lookup with 8s timeout)
affects: [103-manual-ids-tab, 104-zotero-tab]

# Tech tracking
tech-stack:
  added: []
  patterns: [openalex-api-batch-filter, graceful-unresolvable-collection, abort-signal-timeout]

key-files:
  created: [convex/openalex/actions.ts]
  modified: []

key-decisions:
  - "D-06/D-07: Both actions use Convex action (not mutation) since they call external HTTP APIs"
  - "D-08: resolveManualIds batches in groups of 50 per request with pipe-delimited filter"
  - "D-09: resolveByDoi uses 8s AbortSignal timeout (2s buffer for Convex overhead under ZOT-03 10s SLA)"
  - "No 'use node' directive -- only fetch() and process.env needed, both available in default Convex runtime"

patterns-established:
  - "OpenAlex batch filter: pipe-delimited IDs in filter=openalex:W1|W2|...|WN with per_page=100"
  - "Graceful degradation: failed batches/lookups push to unresolvable array instead of throwing"
  - "normalizeOpenAlexId as input whitelist: only W\\d+ passes through regex, preventing injection"

requirements-completed: [SEL-05, ZOT-03]

# Metrics
duration: 2min
completed: 2026-04-16
---

# Phase 100 Plan 03: OpenAlex Resolve Actions Summary

**Batch OpenAlex ID resolution (50-per-batch pipe filter) and single DOI lookup (8s timeout) as Convex actions for Manual IDs and Zotero tabs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-16T08:45:57Z
- **Completed:** 2026-04-16T08:47:43Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `resolveManualIds` action: accepts raw strings, normalizes via regex whitelist, batches into groups of 50, validates against OpenAlex API, returns resolved metadata + unresolvable list
- Created `resolveByDoi` action: single DOI-to-OpenAlex lookup with 8s fetch timeout, returns paper metadata or null
- Both actions use default Convex runtime (no "use node"), OPENALEX_CONTACT_EMAIL env var for polite pool, and AbortSignal.timeout for request deadlines
- Threat model mitigations applied: normalizeOpenAlexId regex whitelist (T-100-06), encodeURIComponent on DOI (T-100-07), polite pool rate limiting (T-100-08)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create convex/openalex/actions.ts with resolveManualIds and resolveByDoi** - `154e9c6` (feat)

## Files Created/Modified
- `convex/openalex/actions.ts` - Two Convex actions for OpenAlex API integration (resolveManualIds for batch ID validation, resolveByDoi for DOI lookup)

## Decisions Made
- Used Convex `action` (not mutation) for both functions since they call external HTTP APIs -- aligns with D-06/D-07
- Batch size of 50 (not 100) to stay under URL length limits -- aligns with D-08
- 8-second fetch timeout for DOI lookup leaves 2s buffer for Convex action overhead -- aligns with D-09
- No `"use node"` directive: file only uses `fetch()` and `process.env`, both available in default Convex runtime per guidelines
- Failed batches gracefully collected in unresolvable array rather than thrown as errors

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing `tsc` error in `tests/crash-prevention/prompt-delimiters.test.ts` (regex flag targeting issue) -- not related to this plan, not modified

## User Setup Required

None - no external service configuration required. OPENALEX_CONTACT_EMAIL env var is optional (falls back to hardcoded email).

## Next Phase Readiness
- `resolveManualIds` ready for consumption by Manual IDs tab (Phase 103, SEL-05)
- `resolveByDoi` ready for consumption by Zotero tab (Phase 104, ZOT-03)
- Both actions are exported as public Convex actions, accessible via `api.openalex.actions.resolveManualIds` and `api.openalex.actions.resolveByDoi`

---
*Phase: 100-backend-wiring-tierselector-fix*
*Completed: 2026-04-16*
