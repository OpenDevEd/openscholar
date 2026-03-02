---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Codebase Hardening
status: unknown
last_updated: "2026-03-02T09:14:49.407Z"
progress:
  total_phases: 8
  completed_phases: 6
  total_plans: 11
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** Phase 40 (next phase in v2.3)

## Current Position

Phase: 40 of 42 (Performance) -- 6 of 8 in v2.3 -- COMPLETE
Plan: 2 of 2 complete (40-01, 40-02)
Status: Phase 40 complete, ready for next phase
Last activity: 2026-03-02 -- Completed 40-02 (unbounded .collect() safety caps)

Progress: [##########] 100% (2/2 plans in phase)

## Performance Metrics

**Velocity:**
- Total plans completed: 69 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 6+)
- Total milestones shipped: 6

**By Milestone:**

| Milestone | Phases | Plans | Shipped |
|-----------|--------|-------|---------|
| v1.0 | 3 | 7 | 2026-02-27 |
| v1.1 | 3 | 6 | 2026-02-27 |
| v1.2 | 7 | 11 | 2026-02-28 |
| v2.0 | 8 | 17 | 2026-02-28 |
| v2.1 | 8 | 15 | 2026-03-01 |
| v2.2 | 4 | 7 | 2026-03-02 |
| v2.3 | 8 | TBD | in progress |

**v2.3 Plan Metrics:**

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 35 | 01 | 2min | 2 | 4 |
| 35 | 02 | 4min | 1 | 6 |
| 35 | 03 | 3min | 2 | 11 |
| 36 | 01 | 3min | 2 | 4 |
| 36 | 02 | 6min | 2 | 7 |
| 37 | 01 | 1min | 1 | 1 |
| 38 | 01 | 2min | 2 | 1 |
| 39 | 01 | 3min | 2 | 6 |
| 39 | 02 | 2min | 1 | 4 |
| 40 | 01 | 1min | 2 | 2 |
| 40 | 02 | 2min | 2 | 3 |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.
- [Phase 35]: Gate all debug/test handlers at function entry with requirePublicDebugEnabled() for consistent security enforcement
- [Phase 35]: Lazy getStripe() singleton for Stripe client init; requireAppUrl() validates NEXT_PUBLIC_APP_URL at function entry with dev/CI fallback
- [Phase 36]: Import ctx types from _generated/server for standalone helper functions; (q: any) casts unnecessary since TypeScript infers index builder types
- [Phase 36]: Use GenericActionCtx<any> for helpers called from Stripe registerRoutes; add explicit return types to break circular ref chains from typed internal refs
- [Phase 37]: Placed rateLimitTables spread at top of defineSchema before all user-defined tables to avoid accidental override
- [Phase 38]: No storageId patch after delete in cascade Step 4 since paper row is deleted immediately after
- [Phase 38]: Job-scoped cleanupFailedPaperStorage avoids need for new global schema index
- [Phase 39]: Sentinel value "ENCRYPTED_SEE_encryptedApiKey" in apiKey field for new connections during transition; resolveZoteroApiKey dual-read fallback pattern
- [Phase 39]: Removed sentinel apiKey write after schema evolution to optional; migration skips rows with no apiKey defensively
- [Phase 40]: Pure scheduling change for N+1 parallelization: only for-loop open/close lines modified, preserving all logic and return types
- [Phase 40]: .take(N) safety caps with CLEANUP_BATCH constant for write-loop mutations; inline .take() for read-only cron queries; CAP constant for shared limits

### Roadmap Evolution

6 milestones shipped. v2.3 roadmap created with 8 phases (35-42), 27 requirements.

### Pending Todos

None.

### Blockers/Concerns

- 3 pre-existing TypeScript errors in test files (unrelated to milestone work)
- extraction/mutations.ts (2000+ lines) is touched by phases 36, 38, and 40 -- strict ordering required

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |

## Session Continuity

Last activity: 2026-03-02 - Completed 40-02-PLAN.md (unbounded .collect() safety caps)
Stopped at: Completed 40-02-PLAN.md
Resume file: None
