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
- v5.0 Extraction Insights Overhaul -- Phases 83-87 (shipped 2026-03-10)
- v6.0 Extraction MVP Rebuild -- Phases 88-97 (in progress)

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

<details>
<summary>v5.0 Extraction Insights Overhaul (Phases 83-87) -- SHIPPED 2026-03-10</summary>

- [x] Phase 83: Test Foundation & i18n Keys (2/2 plans) -- completed 2026-03-10
- [x] Phase 84: Summary Cards & Confidence Display (3/3 plans) -- completed 2026-03-10
- [x] Phase 85: Bar Visualization (4/4 plans) -- completed 2026-03-10
- [x] Phase 86: Question List & Progress Bars (2/2 plans) -- completed 2026-03-10
- [x] Phase 87: Answer Semantic Grouping (3/3 plans) -- completed 2026-03-10

Full details: `.planning/milestones/v5.0-ROADMAP.md`

</details>

### v6.0 Extraction MVP Rebuild (In Progress)

**Milestone Goal:** Hot-swap the extraction pipeline with a clean, MVP-grade implementation — cheap OpenRouter models, free upstream full-text sources, deterministic citation grounding, and zero crash surfaces. Delete all legacy extraction code, tables, and data.

- [ ] **Phase 88: Scorched-Earth Teardown** - Delete all legacy extraction code, tables, UI, and RAG component so nothing dangles after
- [ ] **Phase 89: Core Schema & Workflow Skeleton** - Stand up the new slim schema, durable workflow, and batched enqueue so downstream phases have rails to build on
- [ ] **Phase 90: Free-First Parsing Waterfall** - Resolve full-text via OpenAlex metadata, Europe PMC, arXiv HTML, unpdf, and Gemini-as-PDF-parser with abort-signal ceilings and a 200-page cap
- [ ] **Phase 91: Extraction Cascade Core** - Send whole-paper text to the three-tier OpenRouter cascade with flat 7-field Zod schema, Gemini caching, and per-question parallelism
- [ ] **Phase 92: Deterministic Citation Grounding** - Enforce substring-match quoting, critic pass, insufficient_evidence state, and UI-rendered verbatim quotes
- [ ] **Phase 93: Workflow Cancel, Retry, and Progress** - Targeted cancel, retryable/permanent error taxonomy, early-return on cancelled jobs, and reactive progress updates
- [ ] **Phase 94: Crash Prevention Sweep** - Segment error boundaries, useQuery null handling, Clerk visibility retry, mutation rejection routing, prompt-injection delimiters, fetch timeouts, and Zustand persist reset
- [ ] **Phase 95: Structured Observability & SLO Metrics** - ULID traceId propagation, structured JSON logging, per-job UI metrics, and recall/citation-validity SLO persistence
- [ ] **Phase 96: Eval Loop & Quality Sampling** - 20-case golden set, vitest-evals gating, hourly production sampling cron, and human-review queue
- [ ] **Phase 97: Extraction UI Polish** - Job creation flow, live progress with cancel, verbatim quote rendering, export reuse, 6-locale seed, and brand-aligned design

## Phase Details

### Phase 88: Scorched-Earth Teardown
**Goal**: Delete all legacy extraction code, schema tables, UI surfaces, and the RAG component so the repo compiles cleanly against an empty extraction namespace — the destructive foundation every downstream phase builds on.
**Depends on**: Nothing (milestone start)
**Requirements**: TEAR-01, TEAR-02, TEAR-03, TEAR-04, TEAR-05, TEAR-06, TEAR-07, TEAR-08, TEAR-09, TEAR-10
**Success Criteria** (what must be TRUE):
  1. `convex/extraction/` and `lib/extraction/` directories no longer exist on disk
  2. `convex/schema.ts` contains zero legacy extraction tables (extractionJobs, extractionPapers, extractionQuestions, extractionEvidenceUnits, extractionResults, extractionResultReviews, extractionSavedViews, extractionWorkflowTemplates, extractionReportSnapshots, extractionJobStats, extractionRunDiffs)
  3. `@convex-dev/rag` is absent from `convex/convex.config.ts` and uninstalled from `package.json`
  4. `tsc --noEmit` returns zero errors with no dangling imports or dead exports referencing deleted modules
  5. All six locale files (`messages/{en,fr,es,de,ar,zh}.json`) contain zero `extraction.*` keys left over from the legacy UI
**Plans**: TBD

### Phase 89: Core Schema & Workflow Skeleton
**Goal**: Define the new slim extraction schema (job, paper, question, result tables with `by_paper_question` unique index), register the single `extractionPool` workpool, and stand up a durable `@convex-dev/workflow` whose stages enqueue all papers in one batched mutation and save results idempotently — the rails downstream phases run on.
**Depends on**: Phase 88
**Requirements**: WORK-01, WORK-02, WORK-06, WORK-07
**Success Criteria** (what must be TRUE):
  1. Starting a new extraction job creates exactly one workflow run with per-stage journaled steps (parse → extract → critic → persist), not per-paper journaled steps
  2. `extractionPool` workpool is registered with `maxParallelism` between 3 and 5 and is the only extraction-related pool in `convex.config.ts`
  3. Enqueueing 200 papers fires exactly one batched `enqueueAllPapers` mutation, verified by a test asserting a single Convex write
  4. Persisting the same `(paperId, questionId)` twice is a no-op — a convex-test asserts only one row exists after a double-save, backed by the `by_paper_question` index
**Plans**: TBD

### Phase 90: Free-First Parsing Waterfall
**Goal**: Given a paper with an OpenAlex record, retrieve body text through the cheapest upstream source possible — PMC JATS → arXiv HTML → unpdf → Gemini-as-PDF-parser → abstract-only — with hard abort-signal ceilings, a 200-page cap, and a per-paper `parsing_source` tag surfaced to the UI.
**Depends on**: Phase 89
**Requirements**: PARSE-01, PARSE-02, PARSE-03, PARSE-04, PARSE-05, PARSE-06, PARSE-07, PARSE-08, PARSE-09, PARSE-10
**Success Criteria** (what must be TRUE):
  1. A paper with `ids.pmcid` resolves to full body text via Europe PMC `fullTextXML` parsed by `fast-xml-parser`, verified by a fixture-backed test
  2. A paper with an arXiv ID resolves to full body text via `arxiv.org/html/{id}` parsed by `linkedom`, verified by a fixture-backed test
  3. A paper with only `best_oa_location.pdf_url` resolves via `unpdf`, and on <1500 chars or throw falls through to Gemini `filePart` with `media_resolution: 'low'`
  4. `convex.json` pins Node.js runtime to version 22 so `unpdf` runs without polyfills, verified in the committed config file
  5. A PDF with more than 200 pages is rejected before parsing and every tier has a matching `AbortSignal.timeout` (20s fetch / 30s XML / 60s unpdf / 120s Gemini) — a timeout test for each tier passes
  6. Each paper row records `parsing_source` as one of `pmc`/`arxiv`/`unpdf`/`gemini`/`abstract_only` and the result card renders it verbatim
**Plans**: TBD

### Phase 91: Extraction Cascade Core
**Goal**: Given parsed source text, send the whole paper (no chunking, no RAG, no vector DB) through the three-tier OpenRouter cascade — Gemini 2.5 Flash Lite pre-screen → Gemini 3 Flash default → Claude Haiku 4.5 escalation — using a flat 7-field Zod schema with `propertyOrdering` forcing `reasoning` before `answer`, parallelized per-question with concurrency cap 5, and returning the documented result shape to the UI.
**Depends on**: Phase 90
**Requirements**: EXTR-01, EXTR-02, EXTR-06, EXTR-07, EXTR-09, EXTR-10
**Success Criteria** (what must be TRUE):
  1. An extraction call sends the full parsed source text (no slicing, no embedding, no retrieval) and the committed schema file defines a single 7-field Zod object with `propertyOrdering` enforcing `reasoning` before `answer`
  2. The cascade escalates from Gemini 2.5 Flash Lite → Gemini 3 Flash → Claude Haiku 4.5 through `@openrouter/ai-sdk-provider` with `plugins: [{id: 'response-healing'}]`, verified by a mocked-provider test
  3. OpenRouter calls pin `temperature: 0`, set `provider.order` with `allow_fallbacks`, and rely on Gemini automatic caching — verified by inspecting the built request payload in tests
  4. 10 questions on one paper run via `Promise.allSettled` with concurrency cap 5 and per-question `AbortSignal.timeout(60000)`, and a failure in one question does not abort the other nine — verified by a test
  5. Returned results match `{answer, confidence: "high"|"medium"|"low", evidence: {quote, source_id, start, end}, reasoning, model_used, critic_verdict, parsing_source}` shape, enforced by the Convex result validator
**Plans**: TBD

### Phase 92: Deterministic Citation Grounding
**Goal**: Prevent hallucinated quotes and false-positive answers by rejecting any extraction whose `evidence_quote` fails 85% Levenshtein similarity against the source span, running a critic pass that must return `supported`, emitting `insufficient_evidence` as a first-class answer, and rendering only the verbatim `source.text.slice(start, end)` in the UI.
**Depends on**: Phase 91
**Requirements**: EXTR-03, EXTR-04, EXTR-05, EXTR-08
**Success Criteria** (what must be TRUE):
  1. An extraction whose `evidence_quote` is <85% Levenshtein-similar to the source substring is rejected at the Zod `.superRefine()` boundary — verified by a unit test with a fabricated quote
  2. A critic-pass prompt runs at `T=0` with the same cheap model and any `unsupported` verdict flips the result to `insufficient_evidence` — verified by a mocked-critic test
  3. The extraction result UI renders `source.text.slice(evidence_start_char, evidence_end_char)` and never the model's `evidence_quote` field — verified by a component test asserting the rendered string
  4. `insufficient_evidence` is a first-class answer state with confidence capped and a UI reason line rendered on the result card
**Plans**: TBD

### Phase 93: Workflow Cancel, Retry, and Progress
**Goal**: Make a running extraction job fully controllable: persist each paper's `workpoolId` for targeted cancel (no `cancelAll` blast radius), classify errors as retryable vs permanent so workpool retry fires only on transient failures, early-return cancelled/failed jobs to save LLM spend, and emit real-time progress through Convex reactive queries.
**Depends on**: Phase 92
**Requirements**: WORK-03, WORK-04, WORK-05, WORK-08, WORK-09
**Success Criteria** (what must be TRUE):
  1. Cancelling a running job from the UI iterates persisted `workpoolId` values on paper rows, cancels each targeted item, and marks remaining papers as `cancelled` — verified by an integration test
  2. Network/5xx/429/timeout errors are thrown so workpool retry fires, while 404/400/validation errors return `{success: false}` and are not retried — verified by a classification test
  3. Any workflow-facing action early-returns when `job.status === "cancelled" | "failed"` with zero LLM tokens consumed — verified by a test that asserts the LLM mock is never called for a cancelled job
  4. Reactive Convex subscriptions stream `{processed, failed, remaining}` counters to the UI in under a second on paper completion — verified in the live progress E2E
**Plans**: TBD

### Phase 94: Crash Prevention Sweep
**Goal**: Eliminate every crash surface that can drop a user out of the app — route-segment error boundaries, defensive `useQuery` null/undefined handling, Clerk visibility-change retry, mutation rejection routed to toasts, UUID-delimited prompt injection fence, universal `AbortSignal.timeout` on external fetches, and a Zustand persist migration reset.
**Depends on**: Phase 93
**Requirements**: CRASH-01, CRASH-02, CRASH-03, CRASH-04, CRASH-05, CRASH-06, CRASH-07
**Success Criteria** (what must be TRUE):
  1. Every extraction/results/settings route segment has an `error.tsx` that renders a recovery UI instead of the Next.js crash screen — verified by an E2E that throws inside each segment
  2. Every `useQuery` call site in extraction UI handles both `undefined` (loading) and `null` (not found) before destructuring — verified by a grep-backed lint rule or test
  3. Every user-facing `useMutation` call-site catches rejections and routes them to a toast, so an uncaught rejection cannot bubble to the error boundary — verified by an integration test
  4. PDF body text is wrapped in per-request UUID delimiters and the system prompt instructs the model to trust only delimiter-wrapped content — verified by a prompt snapshot test
  5. Every external `fetch` (OpenRouter, PMC, arXiv, OA PDF hosts) has `AbortSignal.timeout` and a Zustand persist migration ladder collapsed to version 1 — verified by a grep test and a store migration test
**Plans**: TBD

### Phase 95: Structured Observability & SLO Metrics
**Goal**: Give future-us grep-friendly incident triage without a paid observability vendor — every extraction stage emits one structured `console.info` JSON line with ULID `traceId`, failures log with `{errorMessage, errorCategory, retryable}`, the UI shows per-job metrics, and two SLO metrics (recall-on-include, citation-validity-rate) are persisted per run.
**Depends on**: Phase 94
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05
**Success Criteria** (what must be TRUE):
  1. Every extraction stage emits exactly one structured `console.info` JSON line with `{traceId, jobId, paperId, stage, model, tokensIn, tokensOut, costUsd, latencyMs, status}` — verified by a log-capture test
  2. A ULID `traceId` generated in `startExtraction` propagates through every workflow step, workpool context, and LLM call — verified by a test asserting identical `traceId` across stages
  3. Failures log via `console.error` with the same JSON shape plus `{errorMessage, errorCategory, retryable}` — verified by a failure-path test
  4. The UI shows per-job papers-processed, average latency, estimated cost, and error counts fed by a typed Convex query (not `v.any()`)
  5. Each run persists `recall-on-include` and `citation-validity-rate` SLO metrics queryable via a typed Convex query
**Plans**: TBD

### Phase 96: Eval Loop & Quality Sampling
**Goal**: Prevent model regressions and surface production quality drift by maintaining a 20-case hand-labeled golden set, running `vitest-evals` + `autoevals` with CI gating at 95% recall / 98% citation validity, and sampling one production answer per hour into a human-review queue that doubles as the golden-set growth pipeline.
**Depends on**: Phase 95
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06
**Success Criteria** (what must be TRUE):
  1. `tests/evals/screening-golden.ts` contains a 20-case hand-labeled golden set with include/exclude/insufficient cases spanning at least PMC, arXiv, and PDF-fallback parsing sources
  2. `RUN_EVALS=1 pnpm test` runs the golden set via `vitest-evals` + `autoevals` with Factuality and citation-substring-match scorers, and a CI job executes it on every PR touching `convex/extraction/**` or `lib/extraction/**`
  3. CI blocks merges when recall-on-include drops below 95% or citation-validity-rate drops below 98% on the golden set — verified by a deliberately-failing canary branch
  4. An hourly Convex cron samples 1 production answer, runs the critic, and writes `{answerId, verdict, judgeModel, timestamp}` to a `qualityChecks` table
  5. A `getQualityTrend` query returns 7-day rolling `{supported, unsupported, partial}` counts and flagged `unsupported` samples land in a human-review queue table that doubles as the golden-set growth pipeline
**Plans**: TBD

### Phase 97: Extraction UI Polish
**Goal**: Ship the user-facing extraction experience on top of the stabilized backend — clean job creation flow, live progress with per-paper badges and cancel, results cards with clickable verbatim quote highlight, CSV/JSON/XLSX export reusing the library download helper, 6-locale i18n seeded upfront, and brand-aligned Clean/Friendly/Approachable design (OKLCH, Outfit, Framer Motion, WCAG AAA).
**Depends on**: Phase 96
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06
**Success Criteria** (what must be TRUE):
  1. User can create an extraction job via a question builder, model tier selector (auto/cheap/accurate), estimated cost preview, and start button — verified by an E2E flow
  2. User sees a live job view with per-paper status badges (parsing/extracting/done/failed), real-time counters, and a working cancel button — verified by an E2E flow
  3. User sees results on a per-paper card with the clickable verbatim quote highlighted at the source character range — verified by a component test
  4. User exports results as CSV, JSON, or XLSX via the existing library download helper with no new export infrastructure — verified by a reuse test
  5. All extraction UI strings land in all six locale files (en, fr, es, de, ar, zh) BEFORE component development and pages use OKLCH color tokens, Outfit variable font, spring-based Framer Motion, and WCAG AAA contrast
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 88 → 89 → 90 → 91 → 92 → 93 → 94 → 95 → 96 → 97

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
| 83-87 | v5.0 | 14/14 | Complete | 2026-03-10 |
| 88. Scorched-Earth Teardown | v6.0 | 0/TBD | Not started | - |
| 89. Core Schema & Workflow Skeleton | v6.0 | 0/TBD | Not started | - |
| 90. Free-First Parsing Waterfall | v6.0 | 0/TBD | Not started | - |
| 91. Extraction Cascade Core | v6.0 | 0/TBD | Not started | - |
| 92. Deterministic Citation Grounding | v6.0 | 0/TBD | Not started | - |
| 93. Workflow Cancel, Retry, and Progress | v6.0 | 0/TBD | Not started | - |
| 94. Crash Prevention Sweep | v6.0 | 0/TBD | Not started | - |
| 95. Structured Observability & SLO Metrics | v6.0 | 0/TBD | Not started | - |
| 96. Eval Loop & Quality Sampling | v6.0 | 0/TBD | Not started | - |
| 97. Extraction UI Polish | v6.0 | 0/TBD | Not started | - |
