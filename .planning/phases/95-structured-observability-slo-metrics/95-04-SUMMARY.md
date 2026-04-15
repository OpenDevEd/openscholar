---
phase: 95-structured-observability-slo-metrics
plan: 04
subsystem: ui
tags: [job-metrics, slo-visualization, i18n, extraction-ui, accessibility, oklch]

# Dependency graph
requires:
  - phase: 95-structured-observability-slo-metrics
    plan: 01
    provides: "citationValidityRate and recallOnInclude SLO fields on extractionJobs schema"
  - phase: 95-structured-observability-slo-metrics
    plan: 03
    provides: "getExtractionJobMetrics public query returning 6 typed operational + SLO metrics"
provides:
  - "JobMetricsPanel component for per-job observability display"
  - "20 i18n keys under extraction.jobMetrics in all 6 locale files"
  - "SLO threshold visualization with oklch color coding (green/amber/destructive)"
affects: [extraction-job-page, dashboard, phase-97-ui-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: [slo-color-thresholds, responsive-metric-grid, skeleton-loading]

key-files:
  created:
    - components/extraction/job-metrics-panel.tsx
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "oklch color thresholds from existing confidence-badge pattern: green >= 95%, amber >= 80%, destructive < 80%"
  - "Skeleton loading with 4 shimmer rectangles matching 2x2 grid layout for consistent visual"
  - "Null state returns null (no render) matching existing query null-return pattern for auth/not-found"

patterns-established:
  - "SLO visualization: Progress bar fill color via Tailwind [&>div]:bg-* selector targeting shadcn inner div"
  - "Metric cell pattern: icon + value + label with role=group and aria-label for accessibility"
  - "Responsive metric grid: grid-cols-1 sm:grid-cols-2 for 1x4 mobile to 2x2 desktop"

requirements-completed: [OBS-04]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 95 Plan 04: Job Metrics Panel and i18n Summary

**JobMetricsPanel component with 2x2 metric grid, SLO Progress bars with oklch threshold coloring, and 20 i18n keys seeded across all 6 locales**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T08:30:47Z
- **Completed:** 2026-04-15T08:38:45Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Seeded 20 i18n keys under `extraction.jobMetrics` in all 6 locale files (en-US, en-GB, fr, hi, ja, zh)
- French translations are proper French (19/20 keys distinct from English; only `--` shared)
- Created `JobMetricsPanel` component with 4 metric cells (papers processed, avg latency, estimated cost, errors)
- SLO section with Progress bars for citation validity and recall on include, with oklch color thresholds
- Destructive Badge rendered when errorCount > 0
- Full accessibility: role=group, aria-labels on all metric cells, tooltips with contextual explanations
- Skeleton loading state (4 shimmer rectangles) and null-guard for unauthorized access

## Task Commits

Each task was committed atomically:

1. **Task 1: Seed i18n keys in all 6 locale files** - `65b1b8d` (feat)
2. **Task 2: Build JobMetricsPanel component** - `37d146e` (feat)

## Files Created/Modified
- `components/extraction/job-metrics-panel.tsx` - JobMetricsPanel component with reactive Convex query, responsive grid, SLO visualization
- `messages/en-US.json` - 20 jobMetrics keys added under extraction namespace
- `messages/en-GB.json` - 20 jobMetrics keys (English)
- `messages/fr.json` - 20 jobMetrics keys (French translations)
- `messages/hi.json` - 20 jobMetrics keys (English placeholders)
- `messages/ja.json` - 20 jobMetrics keys (English placeholders)
- `messages/zh.json` - 20 jobMetrics keys (English placeholders)

## Decisions Made
- oklch color thresholds reuse the existing confidence-badge pattern (green at 0.55/0.15/145, amber at 0.6/0.12/85) for visual consistency across the extraction UI
- Skeleton loading uses 4 shimmer rectangles in the same grid layout as the populated state for a smooth transition
- Null metrics state returns null (component does not render) matching the existing pattern where server queries return null for auth/ownership failures
- Progress bar fill color uses Tailwind arbitrary `[&>div]:bg-*` selector to target the shadcn Progress inner div

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `convex/extraction/mutations.test.ts` fails due to pre-existing `convex-test` infrastructure issue (`_generated` directory not found in worktree). Verified this failure exists on the base commit before any changes -- not caused by this plan. Documented in 95-01, 95-02, and 95-03 SUMMARYs as well.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `JobMetricsPanel` is ready to be integrated into the extraction job detail page (Phase 97 UI polish)
- All i18n keys are seeded for all 6 locales -- UI renders localized strings out of the box
- Component consumes `getExtractionJobMetrics` query reactively -- will update in real-time as job progresses

## Self-Check: PASSED

- All created files exist (job-metrics-panel.tsx, 95-04-SUMMARY.md)
- Both commits found (65b1b8d, 37d146e)
- All 6 locale files have 20 jobMetrics keys
- JobMetricsPanel exported from component file
- getExtractionJobMetrics query referenced in component
- 4 role=group accessibility attributes present (one per metric cell)

---
*Phase: 95-structured-observability-slo-metrics*
*Completed: 2026-04-15*
