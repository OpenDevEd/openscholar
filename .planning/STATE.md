---
gsd_state_version: 1.0
milestone: v5.0
milestone_name: Extraction Insights Overhaul
status: planning
stopped_at: Completed 86-question-list-progress-bars/86-01-PLAN.md
last_updated: "2026-03-10T10:16:09.234Z"
last_activity: 2026-03-10 — Roadmap created (5 phases, 19/19 requirements mapped)
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 11
  completed_plans: 10
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v5.0 Extraction Insights Overhaul — Phase 83 ready to plan

## Current Position

Phase: 83 of 87 (Test Foundation & i18n Keys)
Plan: —
Status: Ready to plan
Last activity: 2026-03-10 — Roadmap created (5 phases, 19/19 requirements mapped)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 165 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 15, v3.0: 11, v3.1: 20, v3.2: 4, v4.0: 9, v4.1: 5, cleanup: 2, quick: 15)
- Total milestones shipped: 14

**By Milestone:**

| Milestone | Phases | Plans | Shipped |
|-----------|--------|-------|---------|
| v1.0 | 3 | 7 | 2026-02-27 |
| v1.1 | 3 | 6 | 2026-02-27 |
| v1.2 | 7 | 11 | 2026-02-28 |
| v2.0 | 8 | 17 | 2026-02-28 |
| v2.1 | 8 | 15 | 2026-03-01 |
| v2.2 | 4 | 7 | 2026-03-02 |
| v2.3 | 8 | 14 | 2026-03-02 |
| v2.4 | 4 | 7 | 2026-03-03 |
| v2.5 | 7 | 15 | 2026-03-03 |
| v3.0 | 6 | 11 | 2026-03-04 |
| v3.1 | 12 | 20 | 2026-03-05 |
| v3.2 | 3 | 4 | 2026-03-06 |
| v4.0 | 4 | 9 | 2026-03-09 |
| v4.1 | 4 | 5 | 2026-03-09 |
| Phase 83 P02 | 2 | 2 tasks | 1 files |
| Phase 83-test-foundation-i18n-keys P01 | 10 | 3 tasks | 9 files |
| Phase 84-summary-cards-confidence-display P01 | 2 | 2 tasks | 4 files |
| Phase 84-summary-cards-confidence-display P02 | 1min | 1 tasks | 2 files |
| Phase 84-summary-cards-confidence-display P03 | 2min | 2 tasks | 4 files |
| Phase 85-bar-visualization P00 | 1 | 2 tasks | 6 files |
| Phase 85-bar-visualization P01 | 1min | 1 tasks | 2 files |
| Phase 85-bar-visualization P02 | 1min | 2 tasks | 1 files |
| Phase 85-bar-visualization P03 | 3min | 2 tasks | 4 files |
| Phase 85-bar-visualization P03 | 3min | 3 tasks | 4 files |
| Phase 86-question-list-progress-bars P01 | 1min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent decisions for v5.0:
- Zero backend changes: all 6 features consume existing getJobInsights/getQuestionInsights queries
- Recharts ^2.14.0 is the only new dependency, lazy-loaded on insights tab access (INFRA-02)
- i18n keys added in Phase 83 upfront (process-first) to prevent missing-key shipping
- Snapshot tests refactored to structural in Phase 83 before any component changes
- GROUP-* (semantic grouping) deferred to Phase 87 — highest complexity, comes last
- MVP grouping: case/whitespace/basic synonyms only; fuzzy/NLP matching deferred to v5.1+
- [Phase 83]: CitationStatus type added to imports in test file to support precise type-cast assertions
- [Phase 83]: Bar scaling and confidence context tests document Phase 84/85 UI contracts before component implementation
- [Phase 83-01]: Updated vitest.config.ts to include tests/*.test.tsx in jsdom environment — plan specified tsx path outside existing glob coverage
- [Phase 83-01]: i18n keys appended after planGateProNote in all 6 locale files — clean, non-disruptive insertion point at end of extraction namespace
- [Phase 84-01]: Threshold constants use named color keys (green/yellow) for readable boundary comparisons; BADGE_COLOR_CLASSES co-located with threshold logic for single-import component use
- [Phase 84-01]: getConfidenceTooltipKey() is a pure function (no React): no-content > abstract-only > mixed > confidence priority chain
- [Phase 84-02]: Radix tooltip mocked via vi.mock to expose portal content in jsdom for unit tests (TooltipContent wraps in data-testid div)
- [Phase 84-02]: Badge uses className override with BADGE_COLOR_CLASSES to bypass default variant; HelpCircle uses aria-hidden=true since tooltip provides accessible mechanism
- [Phase 84-summary-cards-confidence-display]: SummaryCards mocked in extraction-insights-overview.test.tsx to isolate wiring from Radix Tooltip portal issues in jsdom
- [Phase 84-summary-cards-confidence-display]: totalPapers derived from questions[0].total when available, falls back to noContentCount + abstractOnlyCount
- [Phase 85-bar-visualization]: recharts@^2.15.4 installed as production dependency (satisfies ^2.14.0 constraint)
- [Phase 85-bar-visualization]: Wave 0 test stubs import from non-existent source files confirming RED state for TDD Plans 01 and 02
- [Phase 85-bar-visualization]: Recharts vi.mock pattern established in jsdom stubs — BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer all stubbed
- [Phase 85-bar-visualization]: normalizeToMax sanitizes values to safe[] first then applies Math.max(...safe, 1) — NaN inputs zeroed before guard
- [Phase 85-bar-visualization]: scaleAnswersForDisplay preserves raw count on output items for tooltip display (Pitfall 2 avoidance)
- [Phase 85-bar-visualization]: CITATION_STATUS_COLORS hex values match BADGE_COLOR_CLASSES in card-thresholds.ts to prevent color drift
- [Phase 85-02]: renderTooltipContent exported as pure function — avoids jsdom Tooltip event simulation; directly tests BAR-04 percentage/count formatting
- [Phase 85-02]: isAnimationActive=false on all Recharts Bar components — prevents animation-related jsdom test issues
- [Phase 85-bar-visualization]: bar-visualization.tsx uses named export BarVisualization; bar-chart-content.tsx default export for next/dynamic; test file .tsx for jsdom; rawAnswerDistribution and entityDistribution use BarVisualization; confidenceDistribution and citationStatusMix keep simple Bar
- [Phase 86-question-list-progress-bars]: STATUS_DOT_COLORS.complete hardcoded to #10b981 explicitly matching CITATION_STATUS_COLORS.grounded — no indirect import to prevent tree-shaking fragility
- [Phase 86-question-list-progress-bars]: getAnswerPercentage uses Math.max(total, 1) guard — returns 0 for (0,0) rather than NaN
- [Phase 86-question-list-progress-bars]: statusFromCompletion checks total===0 first — total=0 always returns empty regardless of answered value

### Pending Todos

None.

### Roadmap Evolution

None yet.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |
| 3 | Remove GROBID implementation | 2026-03-04 | d20c59e | | [3-get-rid-of-the-grobid-implementation-ent](./quick/3-get-rid-of-the-grobid-implementation-ent/) |
| 4 | Fix billing e2e auth to use clerk testing token | 2026-03-05 | 6792c9d | | [4-fix-billing-e2e-auth-to-use-clerk-testin](./quick/4-fix-billing-e2e-auth-to-use-clerk-testin/) |
| 5 | Denormalized counters backfill (library + collections) | 2026-03-06 | b6f2446 | | [5-denormalized-counters-backfill-libraryit](./quick/5-denormalized-counters-backfill-libraryit/) |
| 6 | Audit schema vs validators (no mismatches found) | 2026-03-06 | -- | | [6-check-if-theres-any-such-issues](./quick/6-check-if-theres-any-such-issues/) |
| 7 | Redesign screening modal UI/UX | 2026-03-09 | eb1ccb1 | | [7-redesign-screening-modal-ui-ux](./quick/7-redesign-screening-modal-ui-ux/) |
| 8 | Improve create-collection inline flow | 2026-03-09 | c27344b | | [8-improve-create-new-collection-inline-flo](./quick/8-improve-create-new-collection-inline-flo/) |
| 9 | Polish create-collection inline flow | 2026-03-09 | 79fce1e | | [9-polish-screening-dialog-visual-design](./quick/9-polish-screening-dialog-visual-design/) |
| 10 | Extract screening progress into standalone dialog | 2026-03-09 | 12d954f | | [10-extract-screening-progress-into-standalo](./quick/10-extract-screening-progress-into-standalo/) |
| 11 | Move screening button to sidebar footer with progress ring | 2026-03-09 | 6a8dc0b | | [11-move-screening-button-to-sidebar-footer-](./quick/11-move-screening-button-to-sidebar-footer-/) |
| 12 | Enhance screening jobs modal UI/UX | 2026-03-09 | 90e8dc7 | Verified | [12-enhance-screening-jobs-modal-ui-ux-with-](./quick/12-enhance-screening-jobs-modal-ui-ux-with-/) |
| 13 | Disable Review Queue and Report Builder feature flags | 2026-03-10 | 6588d1b | Verified | [13-disable-review-queue-and-report-builder](./quick/13-disable-review-queue-and-report-builder/) |

## Session Continuity

Last activity: 2026-03-10 -- v5.0 roadmap created (phases 83-87)
Stopped at: Completed 86-question-list-progress-bars/86-01-PLAN.md
Resume file: None
