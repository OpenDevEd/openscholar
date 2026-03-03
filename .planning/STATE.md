---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Concerns Sweep
status: unknown
last_updated: "2026-03-03T06:25:01.220Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 7
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v2.4 Concerns Sweep -- Phase 46 complete (milestone complete)

## Current Position

Phase: 46 of 46 (Cron Additions) -- COMPLETE
Plan: 1 of 1 (46-01 Complete)
Status: Milestone Complete
Last activity: 2026-03-03 -- Completed 46-01 (Expired OAuth Token Cleanup Cron)

Progress: [##########] 100% (Phase 46)

## Performance Metrics

**Velocity:**
- Total plans completed: 84 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7)
- Total milestones shipped: 7

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
| Phase 43 P01 | 3min | 3 tasks | 6 files |
| Phase 43 P02 | 3min | 2 tasks | 15 files |
| Phase 44 P01 | 2min | 2 tasks | 2 files |
| Phase 44 P02 | 3min | 2 tasks | 11 files |
| Phase 45 P01 | 5min | 2 tasks | 4 files |
| Phase 45 P02 | 3min | 2 tasks | 1 files |
| Phase 46 P01 | 2min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent decisions affecting v2.4:
- Used .collect() for OAuth token cleanup since table is tiny (0-5 rows); no index needed (46-01)
- try-catch per delete in cron handles concurrent deletion race with getRequestToken (46-01)
- Used statusResultValidator for all auth-gated extraction queries instead of manual v.union patterns (45-02)
- Kept computed/aggregate validators inline in queries, not extracted to validators.ts (45-02)
- getJobInsights job field uses computed subset {id, name} not full document validator (45-02)
- Keep migrateSearchHistoryState external signature as any for Zustand persist compatibility (45-01)
- Use ResultWithReview intersection type for Doc + review overlay rather than separate interface (45-01)
- Truncation fields use v.optional() and conditional spread to only set when truncation occurs (44-02)
- cleanupDeletedUsers defers user hard-delete when extraction jobs hit batch limit, ensuring complete cascade (44-02)
- Preserving creditTransactions, credits, and subscriptions for financial audit trail (44-02)
- cancelAll() cancels ALL pending workpool items across all jobs; credit guards protect correctness for non-cancelled jobs (44-01)
- waitAndExtractAction returns early with empty results when cancelled, avoiding withUserCreditsBatch entirely (44-01)
- Rejected @convex-dev/migrations for apiKey migration -- hand-rolled batched mutation using existing self-scheduling pattern
- Credit reconciliation policy for cancelled jobs: needs product decision before Phase 44
- getJobDetails .collect() safe because ~200-paper job cap is enforced upstream
- Used nullish coalescing (??) for OPENALEX_CONTACT_EMAIL fallback to preserve backward compatibility (43-02)
- Removed clearPlaintextApiKey mutation during schema cleanup -- patching non-schema field would cause runtime errors (43-01)
- Simplified migrateToEncryptedKeys to skip-only post-migration logic (43-01)

### Roadmap Evolution

7 milestones shipped (v1.0 through v2.3). 42 phases, 77 plans total.
v2.4 adds 4 phases (43-46) covering 15 requirements.

### Pending Todos

None.

### Blockers/Concerns

- Credit reconciliation policy for cancelled jobs -- product decision needed before Phase 44 (BUG-01)
- 3 pre-existing TypeScript errors in test files (unrelated to milestone work)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |

## Session Continuity

Last activity: 2026-03-03 - Completed 46-01 (Expired OAuth Token Cleanup Cron)
Stopped at: Completed 46-01-PLAN.md
Resume file: None
