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
- v3.2 Production Readiness -- Phases 72-74 (shipped 2026-03-06)
- v4.0 Bulk Screening & Auto-Rating -- Phases 75-78 (shipped 2026-03-09)
- v4.1 Screening Export -- Phases 79-81 (in progress)

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

<details>
<summary>v3.2 Production Readiness (Phases 72-74) -- SHIPPED 2026-03-06</summary>

- [x] Phase 72: Debug Endpoint Security Hardening (2/2 plans) -- completed 2026-03-06
- [x] Phase 73: Library Count Optimization (1/1 plan) -- completed 2026-03-06
- [x] Phase 74: Query Bounding Audit (1/1 plan) -- completed 2026-03-06

Full details: `.planning/milestones/v3.2-ROADMAP.md`

</details>

<details>
<summary>v4.0 Bulk Screening & Auto-Rating (Phases 75-78) -- SHIPPED 2026-03-09</summary>

- [x] Phase 75: Schema & Job Infrastructure (3/3 plans) -- completed 2026-03-09
- [x] Phase 76: Scoring Engine & Rating Logic (1/1 plan) -- completed 2026-03-09
- [x] Phase 77: Workflow Processing & Library Integration (2/2 plans) -- completed 2026-03-09
- [x] Phase 78: Configuration Dialog & Progress UI (3/3 plans) -- completed 2026-03-09

Full details: `.planning/milestones/v4.0-ROADMAP.md`

</details>

### v4.1 Screening Export (In Progress)

**Milestone Goal:** Enable users to download screening job results as CSV, JSON, or XLSX directly from job history.

- [x] **Phase 79: Export Query** - Auth-gated backend query to fetch all screening results for a completed job (completed 2026-03-09)
- [ ] **Phase 80: Export Functions** - Pure CSV, JSON, and XLSX export functions for screening results
- [ ] **Phase 81: Export UI** - Export dropdown on job history cards with format selection, loading states, and i18n
- [ ] **Phase 82: Simplify Star Thresholds** - Remove maxScore from star thresholds, keep minScore only with highest-match-wins logic

## Phase Details

### Phase 79: Export Query
**Goal**: Users can retrieve all screening results for a completed job through a secure, bounded query
**Depends on**: Nothing (first phase of v4.1; builds on v4.0 screening infrastructure)
**Requirements**: EXP-01
**Success Criteria** (what must be TRUE):
  1. Authenticated user can fetch all results for a screening job they own, receiving paper metadata, per-question answers, score, stars, and qualified status
  2. Unauthenticated users or non-owners cannot access any results (auth gate rejects)
  3. Results are bounded by MAX_SCREENING_PAPERS_PER_JOB to prevent unbounded memory usage
**Plans**: 1 plan

Plans:
- [ ] 79-01-PLAN.md — TDD: getScreeningResultsForExport query + unit tests

### Phase 80: Export Functions
**Goal**: Users can generate screening export files in CSV, JSON, and XLSX formats with complete, correctly formatted result data
**Depends on**: Phase 79
**Requirements**: EXP-02, EXP-03, EXP-04, EXP-05
**Success Criteria** (what must be TRUE):
  1. CSV export contains paper metadata columns, one column per screening question with Yes/No/N/A answers, plus score, stars, and qualified columns
  2. JSON export contains structured paper data with answers object, scoring fields, and job metadata envelope
  3. XLSX export contains a Results sheet with all data and a Summary sheet with job config, scoring rules, and aggregate statistics
  4. Failed or skipped papers appear in all export formats with null/N/A fallbacks for missing answer columns (no crashes, no missing rows)
**Plans**: 1 plan

Plans:
- [ ] 80-01-PLAN.md — TDD: CSV, JSON, and XLSX export functions + unit tests

### Phase 81: Export UI
**Goal**: Users can download screening results directly from job history with format selection and clear visual feedback
**Depends on**: Phase 80
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06
**Success Criteria** (what must be TRUE):
  1. Completed screening job cards in job history display an export button
  2. User can select CSV, JSON, or XLSX from a dropdown menu and the selected format downloads immediately
  3. Exported files have descriptive filenames including the job date and completion status
  4. A loading indicator appears while the export file is being generated, and a warning appears when exporting from cancelled or incomplete jobs
  5. All export UI text (button labels, format names, warnings, loading messages) is translated across all 6 supported locales
**Plans**: TBD

Plans:
- [ ] 81-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 79 -> 80 -> 81 -> 82

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
| 72-74 | v3.2 | 4/4 | Complete | 2026-03-06 |
| 75-78 | v4.0 | 9/9 | Complete | 2026-03-09 |
| 79. Export Query | 1/1 | Complete    | 2026-03-09 | - |
| 80. Export Functions | v4.1 | 0/1 | Not started | - |
| 81. Export UI | v4.1 | 0/1 | Not started | - |
| 82. Simplify Star Thresholds | v4.1 | 0/1 | Not started | - |

### Phase 82: Simplify Star Thresholds
**Goal**: Remove maxScore from star thresholds — each threshold defines only minScore + stars, highest matching minScore wins
**Depends on**: Nothing (independent of export phases; touches scoring engine and UI)
**Requirements**: SCORE-01, SCORE-02, SCORE-03
**Success Criteria** (what must be TRUE):
  1. Star threshold schema, validators, and scoring engine use only minScore + stars (no maxScore field)
  2. Rating assignment evaluates thresholds sorted by minScore descending, first match wins
  3. Existing screening jobs with stored maxScore data are read without error (backward-compatible)
  4. Star threshold editor UI shows only minScore + stars per row
**Plans**: TBD

Plans:
- [ ] 82-01: TBD
