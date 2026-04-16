---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: Extraction Workbench
status: executing
stopped_at: Phase 105 context confirmed (auto re-run)
last_updated: "2026-04-16T18:52:46.105Z"
last_activity: 2026-04-16 -- Phase 105 execution started
progress:
  total_phases: 8
  completed_phases: 7
  total_plans: 23
  completed_plans: 20
  percent: 87
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** Phase 105 — polish-integration-e2e

## Current Position

Milestone: v7.0 Extraction Workbench
Phase: 105 (polish-integration-e2e) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 105
Last activity: 2026-04-16 -- Phase 105 execution started

Progress: [█░░░░░░░░░] 12.5%

## Performance Metrics

**Velocity:**

- Total plans completed: 241 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 15, v3.0: 11, v3.1: 20, v3.2: 4, v4.0: 9, v4.1: 5, v5.0: 14, v6.0: 29, v7.0: 2, cleanup: 2, quick: 15)
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

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent v7.0 decisions affecting current work:

- **Phase 98**: bump `MAX_EXTRACTION_PAPERS_PER_JOB` 200→1000 must benchmark first; split internal `MAX_EXTRACTION_RESULTS_QUERY` from user cap (PITFALL 1).
- **Phase 99**: sessionStorage (not localStorage) for basket — clear only on successful job creation.
- **Phase 100**: TierSelector fix is ~5 edits, NO migration — new rows only.
- **Phase 101**: `@tanstack/react-table@^8.21.3` is the ONLY net-new runtime dep for this milestone. Re-add shadcn `<Table />` primitive; reject shadcn `data-table` block (monolithic — fights 4-view architecture).
- **Phase 103**: highlighted-citation demoted from 4th view to drawer pattern (not all parsing sources are PDFs); card view MUST virtualize via `@tanstack/react-virtual@^3.13.23`; table view does NOT virtualize.
- **Phase 104**: Zotero stays on OAuth 1.0a (verified 2025-09-24); `zotero-api-client` rejected (API-key only).
- [Phase 98]: Per-tier limit map (EXTRACTION_LIMITS_BY_TIER) as single source of truth; MAX_EXTRACTION_PAPERS_PER_JOB derived via Math.max
- [Phase 98]: MAX_EXTRACTION_RESULTS_QUERY (10000) decoupled from user-facing paper limit for internal .take() bounds
- [Phase 98]: Batch seeding in benchmark: 50 papers per txn for papers, 10 papers per txn for results -- avoids convex-test transaction limits
- [Phase 98]: Worst-case benchmark (500-char answers) at 10.31 MB documents upper bound; asserts against 16 MiB Convex hard cap, not 5 MB target
- [Phase 98]: GAP-04 benchmark PASS: typical 1000-paper payload is 3.97 MB (under 5 MB target) -- D-06 pagination fallback NOT needed

### Pending Todos

None.

### Roadmap Evolution

2026-04-14 — v6.0 roadmap created with 10 phases (88-97) mapping all 63 v6.0 requirements.
2026-04-15 — v6.0 milestone archived. 53/63 requirements satisfied, 3 unsatisfied, 4 partial. Known gaps documented.
2026-04-15 — v7.0 Extraction Workbench opened. Recovers pre-v6.0 results UI (table/card/split/highlighted-citation views), adds unified cross-source paper selector (library + collections + search + manual + Zotero with selection-basket), enforces 1000-paper per-job hard limit (per-tier-ready), revives orphaned Zotero OAuth, and closes v6.0 UI-01 + TierSelector orphan.
2026-04-15 — v7.0 roadmap created with 8 phases (98-105) mapping all 42 v7.0 requirements (LIM×7, SEL×12, WB×10, ZOT×6, TIER×3, GAP×4). Critical path: `98 → 99 → 100 → 102 → 103 → 104 → 105`, with Phase 101 parallelizable against 99/100.

### Blockers/Concerns

- ~~**Phase 98 benchmark outcome gates Phase 100 scope.**~~ RESOLVED: benchmark PASSED at 3.97 MB (under 5 MB target). No pagination migration needed for Phase 100.

## Deferred Items

Items carried from v6.0 into v7.0 or later milestones:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v6.0 gap | EVAL-05 `getQualityTrend` UI consumer | Deferred to v7.1 | 2026-04-15 |
| v6.0 gap | EVAL-06 `getReviewQueue` UI page | Deferred to v7.1 | 2026-04-15 |
| v6.0 gap | EXTR-07 `provider.order` in OpenRouter cascade | Unassigned | 2026-04-15 |
| v6.0 gap | WORK-06 `enqueueAllPapers` test invocation | Unassigned | 2026-04-15 |
| v7.0 future | WB-F01 Bulk re-run | Deferred to v7.1 | 2026-04-15 |
| v7.0 future | WB-F03 `evidenceContextBefore/After` schema | Deferred to v7.1 | 2026-04-15 |

## Session Continuity

Last session: 2026-04-16T18:52:46.102Z
Stopped at: Phase 105 context confirmed (auto re-run)
Next step: `/gsd-discuss-phase 99`
