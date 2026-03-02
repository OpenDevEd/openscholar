---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Codebase Hardening
status: complete
last_updated: "2026-03-02T10:35:13Z"
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 14
  completed_plans: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** Phase 42 complete -- v2.3 milestone complete

## Current Position

Phase: 42 of 42 (Test Coverage) -- 8 of 8 in v2.3 -- COMPLETE
Plan: 2 of 2 complete (42-01, 42-02)
Status: Phase 42 complete, v2.3 milestone complete
Last activity: 2026-03-02 -- Completed 42-02 (store migrations + insight edge cases)

Progress: [##########] 100% (2/2 plans in phase)

## Performance Metrics

**Velocity:**
- Total plans completed: 71 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 8+)
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
| 41 | 01 | 2min | 2 | 5 |
| 42 | 01 | 2min | 1 | 1 |
| 42 | 02 | 3min | 2 | 3 |

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
- [Phase 41]: Shared start-extraction rate limit across 3 extraction mutations; shared checkout-session limit across subscription and credit top-up; auth-first rate limit ordering pattern
- [Phase 42]: vi.useFakeTimers() must be called BEFORE scheduler-triggering mutations; extractionPapers has no createdAt field
- [Phase 42]: Pure extraction of inline Zustand persist migrate function as named export for testability (zero logic change)

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

Last activity: 2026-03-02 - Completed 42-02-PLAN.md (store migrations + insight edge cases)
Stopped at: Completed 42-02-PLAN.md
Resume file: None
