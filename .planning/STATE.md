---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: Extraction Workbench
status: shipped
stopped_at: v7.0 milestone shipped; ready for v7.1 planning via /gsd-new-milestone
last_updated: "2026-04-16T23:59:00.000Z"
last_activity: 2026-04-16
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 23
  completed_plans: 23
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16 after v7.0 milestone)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** Planning next milestone (v7.1 candidates: close v7.0 audit gaps, tier-specific limits, workbench extensions, quality/review UIs)

## Current Position

Milestone: v7.0 Extraction Workbench — SHIPPED 2026-04-16
Phase: — (milestone closed)
Plan: —
Status: Ready for next milestone
Last activity: 2026-04-16

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 244 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 15, v3.0: 11, v3.1: 20, v3.2: 4, v4.0: 9, v4.1: 5, v5.0: 14, v6.0: 29, v7.0: 2, cleanup: 2, quick: 15)
- Total milestones shipped: 16

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
| v5.0 | 5 | 14 | 2026-03-10 |
| v6.0 | 10 | 29 | 2026-04-15 |
| v7.0 | 8 planned (98-105) | TBD | in progress |
| Phase 98 P01 | 129 | 2 tasks | 3 files |
| Phase 98 P02 | 342 | 2 tasks | 3 files |
| Phase 105 P01 | 7m47s | 2 tasks | 4 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

v7.0 decisions compacted into PROJECT.md after milestone close. Fresh decisions will accumulate here during v7.1.

### Pending Todos

None.

### Roadmap Evolution

2026-04-14 — v6.0 roadmap created with 10 phases (88-97) mapping all 63 v6.0 requirements.
2026-04-15 — v6.0 milestone archived. 53/63 requirements satisfied, 3 unsatisfied, 4 partial. Known gaps documented.
2026-04-15 — v7.0 Extraction Workbench opened. Recovers pre-v6.0 results UI (table/card/split/highlighted-citation views), adds unified cross-source paper selector (library + collections + search + manual + Zotero with selection-basket), enforces 1000-paper per-job hard limit (per-tier-ready), revives orphaned Zotero OAuth, and closes v6.0 UI-01 + TierSelector orphan.
2026-04-15 — v7.0 roadmap created with 8 phases (98-105) mapping all 42 v7.0 requirements (LIM×7, SEL×12, WB×10, ZOT×6, TIER×3, GAP×4). Critical path: `98 → 99 → 100 → 102 → 103 → 104 → 105`, with Phase 101 parallelizable against 99/100.
2026-04-16 — v7.0 milestone shipped. 35/42 requirements satisfied (83%), 1 unsatisfied (WB-07), 6 partial (SEL-09, LIM-01/02/03, GAP-03, GAP-04). Closes v6.0 UI-01, EXTR-01, PARSE-07, CRASH-02.

### Blockers/Concerns

None — v7.0 shipped. v7.1 candidates: close v7.0 audit gaps (WB-07, SEL-09, UI-01/UI-02, GAP-03 scope), tier-specific limits, workbench extensions, quality/review UIs.

## Deferred Items

Items acknowledged and deferred at v7.0 milestone close on 2026-04-16:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v7.0 gap (unsat) | WB-07 evidence drawer click chain — `void openEvidence;` in workbench-shell.tsx:132, no onClick in EvidenceQuote/CardView/SplitView | Deferred to v7.1 | 2026-04-16 |
| v7.0 gap (partial) | SEL-09 BasketTriggerButton — component exists but not mounted in global app shell | Deferred to v7.1 | 2026-04-16 |
| v7.0 gap (partial) | LIM-01/LIM-02/LIM-03/GAP-04 — Phase 98 VERIFICATION.md missing | Deferred to v7.1 (retrofit) | 2026-04-16 |
| v7.0 gap (partial) | GAP-03 ESLint scope hole — lib/hooks/use-add-to-basket.ts:97 `?? 1000` fallback | Deferred to v7.1 | 2026-04-16 |
| v7.0 integration | UI-01 extraction-dialog post-submit wiring — no `router.push('/extraction/' + newJobId)`, no `basket.clear()` | Deferred to v7.1 | 2026-04-16 |
| v7.0 integration | UI-02 zombie ExtractionDialog in /extraction list page (no papers prop, silent no-op) | Deferred to v7.1 | 2026-04-16 |
| v7.0 integration | IN-02 duplicate getExtractionLimit subscriptions across 3 components (perf, non-blocking) | Deferred to v7.1 | 2026-04-16 |
| v7.0 tech debt | Nyquist wave 0 closure for phases 98, 99, 100, 101, 102, 104 | Deferred to v7.1 | 2026-04-16 |
| v7.0 tech debt | 1161 pre-existing ESLint errors from phases 100-104 | Deferred to v7.1 | 2026-04-16 |
| v7.0 tech debt | DEF-105-01 convex/extraction/extract.test.ts regex flag error | Deferred to v7.1 | 2026-04-16 |
| v7.0 tech debt | DEF-105-02 convex/zotero/purge.test.ts failure | Deferred to v7.1 | 2026-04-16 |
| v7.0 tech debt | 3 items in 105-HUMAN-UAT.md require manual browser testing | Awaiting UAT | 2026-04-16 |
| v7.0 future | WB-F01 Bulk re-run | Deferred to v7.1 | 2026-04-15 |
| v7.0 future | WB-F03 `evidenceContextBefore/After` schema | Deferred to v7.1 | 2026-04-15 |
| v7.0 future | QUAL-F01 Human-review queue UI (v6.0 backend exists) | Deferred to v7.1 | 2026-04-16 |
| v7.0 future | QUAL-F02 Quality-trend dashboard UI (v6.0 backend exists) | Deferred to v7.1 | 2026-04-16 |
| v7.0 future | LIM-F01 Tier-specific limits via EXTRACTION_LIMITS_BY_TIER tuning | Deferred to v7.1 | 2026-04-16 |
| v7.0 future | MOB-F01 Mobile bottom-sheet drawer variant | Deferred to v7.1 | 2026-04-16 |
| v6.0 carried | EXTR-07 `provider.order` in OpenRouter cascade | Unassigned | 2026-04-15 |
| v6.0 carried | WORK-06 `enqueueAllPapers` test invocation | Unassigned | 2026-04-15 |

## Session Continuity

Last session: 2026-04-16T23:59:00Z
Stopped at: v7.0 milestone shipped and archived; 8 phases (98-105) complete; 23 plans executed
Next step: `/gsd-new-milestone` (v7.1)
