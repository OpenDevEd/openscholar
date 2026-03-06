# Roadmap: OpenAlex Count

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (shipped 2026-02-28)
- v2.1 Library & Collections -- Phases 22-30 (shipped 2026-03-01)
- v2.2 Library UI Overhaul -- Phases 31-34 (shipped 2026-03-02)
- v2.3 Codebase Hardening -- Phases 35-42 (shipped 2026-03-02)
- v2.4 Concerns Sweep -- Phases 43-46 (shipped 2026-03-03)
- v2.5 Tech Debt Purge -- Phases 47-53 (shipped 2026-03-03)
- v3.0 Zero-Any Overhaul -- Phases 54-59 (shipped 2026-03-04)
- v3.1 Complete Type Safety -- Phases 60-71 (shipped 2026-03-05)
- v3.2 Production Readiness -- Phases 72-74 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Upgrade Flow (Phases 4-6) -- SHIPPED 2026-02-27</summary>

- [x] Phase 4: Upgrade Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 5: Upgrade Resilience (2/2 plans) -- completed 2026-02-27
- [x] Phase 6: UX Polish (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>v1.2 E2E Billing Tests (Phases 7-13) -- SHIPPED 2026-02-28</summary>

- [x] Phase 7: Test Infrastructure Foundation (3/3 plans) -- completed 2026-02-28
- [x] Phase 8: Subscription and Upgrade Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 9: Lifecycle and Credit Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 10: Fix Credits Spec Auth Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 11: Tech Debt Cleanup (1/1 plan) -- completed 2026-02-28
- [x] Phase 12: Billing E2E CI Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 13: CI Env Hardening & CRED-02 Regression (1/1 plan) -- completed 2026-02-28

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>v2.0 TDD & Test Coverage (Phases 14-21) -- SHIPPED 2026-02-28</summary>

- [x] Phase 14: Test Infrastructure (1/1 plan) -- completed 2026-02-28
- [x] Phase 15: AI Prompts & Schema Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 16: AI Batch Processing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 17: AI Cost & Billing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 18: Search & Filter Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 19: Data Export Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 20: User Auth & State Machine Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 21: Plan Enforcement & Feature Gating Tests (2/2 plans) -- completed 2026-02-28

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>v2.1 Library & Collections (Phases 22-30) -- SHIPPED 2026-03-01</summary>

- [x] Phase 22: Schema & Rating Bridge (2/2 plans) -- completed 2026-02-28
- [x] Phase 23: Core Library Page (2/2 plans) -- completed 2026-02-28
- [x] Phase 24: Advanced Filtering & URL State (2/2 plans) -- completed 2026-02-28
- [x] Phase 25: Collections (3/3 plans) -- completed 2026-03-01
- ~~Phase 26: Export & Polish~~ -- Superseded by Phases 29-30
- [x] Phase 27: Library UI Redesign (2/2 plans) -- completed 2026-03-01
- [x] Phase 28: Bug Fixes & Verification (2/2 plans) -- completed 2026-03-01
- [x] Phase 29: Library Export (1/1 plan) -- completed 2026-03-01
- [x] Phase 30: Library Polish (1/1 plan) -- completed 2026-03-01

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

<details>
<summary>v2.2 Library UI Overhaul (Phases 31-34) -- SHIPPED 2026-03-02</summary>

- [x] Phase 31: Generalized Layout Infrastructure (2/2 plans) -- completed 2026-03-01
- [x] Phase 32: Search Page Sidebar Refactor (2/2 plans) -- completed 2026-03-01
- [x] Phase 33: Library Page UI Overhaul (2/2 plans) -- completed 2026-03-01
- [x] Phase 34: Display Polish and Validation (2/2 plans) -- completed 2026-03-01

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

<details>
<summary>v2.3 Codebase Hardening (Phases 35-42) -- SHIPPED 2026-03-02</summary>

- [x] Phase 35: Quick Wins & Debug Cleanup (3/3 plans) -- completed 2026-03-02
- [x] Phase 36: Type Safety Sweep (2/2 plans) -- completed 2026-03-02
- [x] Phase 37: Schema Additions (1/1 plan) -- completed 2026-03-02
- [x] Phase 38: Deletion Cascade & Storage Cleanup (1/1 plan) -- completed 2026-03-02
- [x] Phase 39: Zotero Key Encryption (2/2 plans) -- completed 2026-03-02
- [x] Phase 40: Performance (2/2 plans) -- completed 2026-03-02
- [x] Phase 41: Rate Limiting Enforcement (1/1 plan) -- completed 2026-03-02
- [x] Phase 42: Test Coverage (2/2 plans) -- completed 2026-03-02

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

<details>
<summary>v2.4 Concerns Sweep (Phases 43-46) -- SHIPPED 2026-03-03</summary>

- [x] Phase 43: Schema Migration & Quick Wins (2/2 plans) -- completed 2026-03-02
- [x] Phase 44: Workflow & Deletion Integrity (2/2 plans) -- completed 2026-03-03
- [x] Phase 45: Type Safety Sweep (2/2 plans) -- completed 2026-03-03
- [x] Phase 46: Cron Additions (1/1 plan) -- completed 2026-03-03

Full details: `.planning/milestones/v2.4-ROADMAP.md`

</details>

<details>
<summary>v2.5 Tech Debt Purge (Phases 47-53) -- SHIPPED 2026-03-03</summary>

- [x] Phase 47: Test Safety Net (3/3 plans) -- completed 2026-03-03
- [x] Phase 48: Billing Hardening (2/2 plans) -- completed 2026-03-03
- [x] Phase 49: Extraction & Library Type Safety (2/2 plans) -- completed 2026-03-03
- [x] Phase 50: Security & Schema (2/2 plans) -- completed 2026-03-03
- [x] Phase 51: Performance (2/2 plans) -- completed 2026-03-03
- [x] Phase 52: Cleanup & Organization (2/2 plans) -- completed 2026-03-03
- [x] Phase 53: TypeScript Compile Fix (2/2 plans) -- completed 2026-03-03

Full details: `.planning/milestones/v2.5-ROADMAP.md`

</details>

<details>
<summary>v3.0 Zero-Any Overhaul (Phases 54-59) -- SHIPPED 2026-03-04</summary>

- [x] Phase 54: Type Safety Sweep (2/2 plans) -- completed 2026-03-03
- [x] Phase 55: Security and Audit (2/2 plans) -- completed 2026-03-04
- [x] Phase 56: Performance Fixes (2/2 plans) -- completed 2026-03-04
- [x] Phase 57: Incremental Aggregation (2/2 plans) -- completed 2026-03-04
- [x] Phase 58: Correctness and Coverage (2/2 plans) -- completed 2026-03-04
- [x] Phase 59: Tech Debt Cleanup (1/1 plan) -- completed 2026-03-04

Full details: `.planning/milestones/v3.0-ROADMAP.md`

</details>

<details>
<summary>v3.1 Complete Type Safety (Phases 60-71) -- SHIPPED 2026-03-05</summary>

- [x] Phase 60: Convex Validators & Typed Records (3/3 plans) -- completed 2026-03-04
- [x] Phase 61: Convex Production Backend (2/2 plans) -- completed 2026-03-04
- [x] Phase 62: Convex Debug & Test Backend (1/1 plan) -- completed 2026-03-04
- [x] Phase 63: Client Libraries (3/3 plans) -- completed 2026-03-04
- [x] Phase 64: Components (2/2 plans) -- completed 2026-03-04
- [x] Phase 65: Mock Factories (1/1 plan) -- completed 2026-03-04
- [x] Phase 66: Test Files (2/2 plans) -- completed 2026-03-04
- [x] Phase 67: Compiler Verification (2/2 plans) -- completed 2026-03-04
- [x] Phase 68: Fix Stripe Webhook Type Boundary (1/1 plan) -- completed 2026-03-05
- [x] Phase 69: Fix Pre-existing TSC Errors (1/1 plan) -- completed 2026-03-05
- [x] Phase 70: Documentation & Dead Code Cleanup (1/1 plan) -- completed 2026-03-05
- [x] Phase 71: Verification Script & Validator\<any\> Fix (1/1 plan) -- completed 2026-03-05

Full details: `.planning/milestones/v3.1-ROADMAP.md`

</details>

### v3.2 Production Readiness (In Progress)

**Milestone Goal:** Fix security and performance blockers before production launch.

- [x] **Phase 72: Debug Endpoint Security Hardening** - Convert public debug functions to internal, eliminate env-var gate (completed 2026-03-06)
- [x] **Phase 73: Library Count Optimization** - Replace document-scan counting with atomic denormalized counter (completed 2026-03-06)
- [ ] **Phase 74: Query Bounding Audit** - Bound high-traffic .collect() calls with .take(N) guards

## Phase Details

### Phase 72: Debug Endpoint Security Hardening
**Goal**: Debug/test endpoints are architecturally unreachable from client SDK
**Depends on**: Nothing (independent)
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. All debug query/mutation functions use `internalQuery`/`internalMutation` and do not appear in the generated `api` namespace
  2. The `debug_gate.ts` module and `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var no longer exist in the codebase
  3. Tests verify debug functions are registered as internal (not that an env gate blocks them)
  4. `tsc --noEmit` passes with zero errors after all API path changes
**Plans:** 2/2 plans complete
Plans:
- [ ] 72-01-PLAN.md -- Convert all 12 debug files to internal + write replacement test
- [ ] 72-02-PLAN.md -- Delete debug gate module and old test, verify clean build

### Phase 73: Library Count Optimization
**Goal**: Library page loads item count in O(1) without scanning documents
**Depends on**: Nothing (independent)
**Requirements**: PERF-01, PERF-02, PERF-03
**Success Criteria** (what must be TRUE):
  1. `getLibraryCount` reads a counter value instead of fetching and counting documents
  2. Saving a paper to library increments the counter; removing a paper decrements it (including bulk remove)
  3. A user with no pre-existing counter gets an accurate count computed and persisted on first access (lazy backfill)
  4. Counter stays correct across save, remove, and bulk-remove sequences (test-verified)
**Plans**: 1 plan
Plans:
- [ ] 73-01-PLAN.md -- Schema change + counter wiring + tests

### Phase 74: Query Bounding Audit
**Goal**: All high-traffic query paths have explicit upper bounds preventing unbounded memory growth
**Depends on**: Nothing (independent)
**Requirements**: PERF-04, PERF-05
**Success Criteria** (what must be TRUE):
  1. Every high-traffic `.collect()` call has an explicit `.take(N)` guard with a documented MAX constant
  2. Cascade delete paths do not use `.take(N)` bounds that would silently orphan data (verified by inspection or test)
  3. Naturally-bounded `.collect()` calls (small cardinality tables) have inline comments documenting their expected cardinality
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 72 -> 73 -> 74

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-3 | v1.0 | 7/7 | Complete | 2026-02-27 |
| 4-6 | v1.1 | 6/6 | Complete | 2026-02-27 |
| 7-13 | v1.2 | 11/11 | Complete | 2026-02-28 |
| 14-21 | v2.0 | 17/17 | Complete | 2026-02-28 |
| 22-30 | v2.1 | 15/15 | Complete | 2026-03-01 |
| 31-34 | v2.2 | 7/7 | Complete | 2026-03-02 |
| 35-42 | v2.3 | 14/14 | Complete | 2026-03-02 |
| 43-46 | v2.4 | 7/7 | Complete | 2026-03-03 |
| 47-53 | v2.5 | 15/15 | Complete | 2026-03-03 |
| 54-59 | v3.0 | 11/11 | Complete | 2026-03-04 |
| 60-71 | v3.1 | 20/20 | Complete | 2026-03-05 |
| 72. Debug Endpoint Security | 2/2 | Complete    | 2026-03-06 | - |
| 73. Library Count Optimization | 1/1 | Complete   | 2026-03-06 | - |
| 74. Query Bounding Audit | v3.2 | 0/0 | Not started | - |
