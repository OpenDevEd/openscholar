---
gsd_state_version: 1.0
milestone: v2.5
milestone_name: Tech Debt Purge
status: in-progress
last_updated: "2026-03-03T09:46:08Z"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 11
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-03)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v2.5 Tech Debt Purge -- Phase 51 in progress

## Current Position

Phase: 51 of 52 (Performance) -- 5 of 6 in v2.5
Plan: 2 of 2 in Phase 51 (COMPLETE)
Status: Phase 51 plan 02 complete
Last activity: 2026-03-03 -- Completed 51-02 (cron index optimization + crypto import modernization)

Progress: [████████░░] 83%

## Performance Metrics

**Velocity:**
- Total plans completed: 91 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 7)
- Total milestones shipped: 8

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
| v2.5 | 6 | ? | -- |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

- [47-03] Used vi.resetModules() + dynamic import() for env var isolation in debug gate tests
- [47-03] Used fs.readFileSync inventory pattern for static analysis of debug-gated files
- [48-01] Kept GenericActionCtx<any> in stripeWebhookHandlers.ts -- DataModel generic unavailable in utility files
- [48-01] Left user: any and error: any casts out of scope for TYPE-01 (Stripe object casts only)
- [48-02] Convex is source of truth for pending plan changes; Stripe metadata preserved for backward compat
- [48-02] Upgrade metadata still written to Stripe for invoice webhook path (TODO for future migration)
- [49-01] Used Id<"extractionPapers"> cast for paperId in review-queue citation panel (string from query result)
- [49-01] Applied "as const" for validated: true literal to satisfy CitationLocation type constraint
- [49-02] All searchFiltersValidator fields are v.optional() for backward compat with existing stored data
- [49-02] Moved searchFiltersValidator before extractionJobValidator to fix declaration order dependency
- [50-01] Used console.log JSON audit format matching existing AUDIT pattern ([AUDIT:KEY_DECRYPT]) for consistency
- [50-01] Used String(job.userId) fallback to "system" for extraction workpool decrypt (internal action)
- [50-02] Used structured console.log with [AUDIT:DEBUG_ACCESS] prefix for grep-friendly audit trail in Convex logs
- [51-02] Kept .take(100) on OAuth cleanup to bound memory per cron run
- [51-02] Preserved by_status index alongside new by_status_updatedAt for backward compat with other queries

### Roadmap Evolution

8 milestones shipped (v1.0 through v2.4). 46 phases, 84 plans total.
v2.5 roadmap: 6 phases (47-52), 25 requirements across 8 categories.

### Pending Todos

None.

### Blockers/Concerns

- ~~TEST-03 must complete before BILL-01 can execute~~ (RESOLVED: BILL-01 completed in 48-01)
- ~~TYPE-05 requires a two-deploy schema migration (make encryptedApiKey required)~~ (RESOLVED: completed in 50-01)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |

## Session Continuity

Last activity: 2026-03-03 - Completed 51-02-PLAN.md (cron index optimization + crypto import modernization)
Stopped at: Completed 51-02-PLAN.md
Resume file: None
