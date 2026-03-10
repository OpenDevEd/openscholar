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
- v4.1 Screening Export -- Phases 79-82 (shipped 2026-03-09)
- v5.0 Extraction Insights Overhaul -- Phases 83-87 (in progress)

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

<details>
<summary>v4.1 Screening Export (Phases 79-82) -- SHIPPED 2026-03-09</summary>

- [x] Phase 79: Export Query (1/1 plan) -- completed 2026-03-09
- [x] Phase 80: Export Functions (1/1 plan) -- completed 2026-03-09
- [x] Phase 81: Export UI (1/1 plan) -- completed 2026-03-09
- [x] Phase 82: Simplify Star Thresholds (2/2 plans) -- completed 2026-03-09

Full details: `.planning/milestones/v4.1-ROADMAP.md`

</details>

### v5.0 Extraction Insights Overhaul (Phases 83-87)

**Milestone Goal:** Overhaul the extraction insights page to fix data visualization issues, merge semantic duplicates, and improve overall UX/UI quality. Zero backend changes — all features consume data from existing queries.

- [x] **Phase 83: Test Foundation & i18n Keys** - Refactor snapshot tests to structural, add edge-case tests, seed all new locale strings upfront (completed 2026-03-10)
- [ ] **Phase 84: Summary Cards & Confidence Display** - Color-accented metric cards and contextual confidence badge
- [ ] **Phase 85: Bar Visualization** - Relative-to-max scaling and stacked horizontal bars with Recharts
- [ ] **Phase 86: Question List & Progress Bars** - Status dots and mini progress bars for scannability
- [ ] **Phase 87: Answer Semantic Grouping** - Merge synonym variants with expandable drill-down

## Phase Details

### Phase 83: Test Foundation & i18n Keys
**Goal**: The insights test suite uses structural assertions (not snapshots) and all 6 locale files contain every new translation key, so subsequent UI phases can iterate without breaking tests or shipping missing-key placeholders.
**Depends on**: Nothing (first phase of milestone)
**Requirements**: INFRA-01
**Success Criteria** (what must be TRUE):
  1. InsightsOverview.test.ts assertions target DOM structure and data attributes, not rendered HTML snapshots — a component refactor does not trigger test failures
  2. All new extraction insights translation keys exist in all 6 locale JSON files (en, fr, de, es, ja, zh) before any UI component is written
  3. Edge-case tests exist for bar scaling (all-zero distribution, single-dominant value, one-answer question) with documented expected outputs
  4. Edge-case tests exist for confidence context mapping (abstract-only cap, no content, full-text) with documented expected outputs
**Plans**: 2 plans

Plans:
- [ ] 83-01-PLAN.md — Seed i18n keys into all 6 locale files, create i18n coverage test and structural component test
- [ ] 83-02-PLAN.md — Add bar scaling and confidence context edge-case tests to extraction-insights.test.ts

### Phase 84: Summary Cards & Confidence Display
**Goal**: Users scanning the insights overview see reordered summary cards with color-coded health signals and a single contextual confidence badge that explains why the confidence value is what it is.
**Depends on**: Phase 83
**Requirements**: CARD-01, CARD-02, CARD-03, CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. Summary cards appear in actionable order — completion and quality metrics appear before derived/secondary metrics
  2. Each card displays a color accent (green/yellow/red) that changes based on the metric value crossing defined thresholds, visible without interaction
  3. Metrics that are misleading in abstract-only jobs (e.g., "0% grounded") are contextualized or hidden rather than shown as alarming zeroes
  4. A single confidence badge replaces "effective confidence" and shows one clear percentage with a tooltip explaining its source (abstract cap, full-text, no content)
  5. The confidence badge color matches the value: green for >=85%, yellow for 60-84%, red for <60%
**Plans**: TBD

### Phase 85: Bar Visualization
**Goal**: Users looking at answer distributions see bars that meaningfully fill the available space, with stacked horizontal bars showing the part-to-whole breakdown per question, rendered via Recharts loaded only on demand.
**Depends on**: Phase 83
**Requirements**: BAR-01, BAR-02, BAR-03, BAR-04, INFRA-02
**Success Criteria** (what must be TRUE):
  1. Answer distribution bars scale relative to the highest count — the dominant answer fills the bar container and minority answers are visually proportional to it, not invisible at 2-4%
  2. A stacked horizontal bar renders per question showing grounded/best-effort/insufficient/error segments as distinct colored regions
  3. Edge cases render without NaN or layout breaks: all-zero distributions show empty state, single-dominant values show one full bar, single-answer questions show a single segment
  4. Each bar or segment displays a count label and percentage value on hover or keyboard focus
  5. Recharts (~65KB gzipped) is only loaded when the user navigates to the insights tab, not on initial page load
**Plans**: TBD

### Phase 86: Question List & Progress Bars
**Goal**: Users can scan the question list at a glance to see which questions have complete, partial, or empty extraction coverage without expanding individual questions.
**Depends on**: Phase 85
**Requirements**: QLIST-01, QLIST-02, QLIST-03
**Success Criteria** (what must be TRUE):
  1. Each question in the list shows a status dot — green for complete (all papers answered), yellow for partial, grey for empty — visible without expanding the question
  2. Each question shows a mini progress bar indicating the percentage of papers that returned an answer, with the percentage displayed as text alongside the bar
  3. The question list is scannable end-to-end without any expand/collapse interaction — all status and progress information is visible in the collapsed list view
  4. Progress bars render 0% (not NaN) when a question has zero answers, and aria-valuenow plus aria-label are present for accessibility
**Plans**: TBD

### Phase 87: Answer Semantic Grouping
**Goal**: Users see deduplicated answer distributions where case variants, whitespace differences, and common synonyms are merged into single representative groups, with expandable drill-down to inspect individual variants.
**Depends on**: Phase 86
**Requirements**: GROUP-01, GROUP-02, GROUP-03, GROUP-04
**Success Criteria** (what must be TRUE):
  1. Answers that differ only by case, leading/trailing whitespace, or basic synonym equivalence appear as a single grouped row rather than multiple near-duplicate rows
  2. Each grouped row shows a disclosure control (e.g., "5 variants") that expands inline to reveal the individual raw answer strings and their individual counts
  3. The count shown on a grouped row is the sum of all variant counts — the aggregated total is accurate and matches the sum of expanded variant counts
  4. The disagreement detection logic treats grouped answers as equivalent — papers that gave semantically identical answers are not flagged as disagreements
**Plans**: TBD

## Progress

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
| 79-82 | v4.1 | 5/5 | Complete | 2026-03-09 |
| 83 | 2/2 | Complete    | 2026-03-10 | - |
| 84 | v5.0 | 0/TBD | Not started | - |
| 85 | v5.0 | 0/TBD | Not started | - |
| 86 | v5.0 | 0/TBD | Not started | - |
| 87 | v5.0 | 0/TBD | Not started | - |
