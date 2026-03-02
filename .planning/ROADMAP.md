# Roadmap: OpenAlex Count

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (shipped 2026-02-28)
- v2.1 Library & Collections -- Phases 22-30 (shipped 2026-03-01)
- v2.2 Library UI Overhaul -- Phases 31-34 (shipped 2026-03-02)
- v2.3 Codebase Hardening -- Phases 35-42 (in progress)

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
- [x] Phase 32: Search Page Sidebar Refactor (1/1 plan) -- completed 2026-03-01
- [x] Phase 33: Library Page UI Overhaul (2/2 plans) -- completed 2026-03-01
- [x] Phase 34: Display Polish and Validation (2/2 plans) -- completed 2026-03-01

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

### v2.3 Codebase Hardening (In Progress)

**Milestone Goal:** Address all identified concerns -- bugs, type safety, security, performance, fragile areas, and test coverage gaps.

- [x] **Phase 35: Quick Wins & Debug Cleanup** - Remove debug logs, fix ts-ignore, harden config, delete legacy code (completed 2026-03-02)
- [x] **Phase 36: Type Safety Sweep** - Replace all `any` casts with proper Convex-generated types (completed 2026-03-02)
- [ ] **Phase 37: Schema Additions** - Deploy rate limit table and Zotero encryption fields as optional
- [ ] **Phase 38: Deletion Cascade & Storage Cleanup** - Fix orphaned child records and leaked storage on job deletion
- [ ] **Phase 39: Zotero Key Encryption** - Encrypt the only plaintext user secret in the database
- [ ] **Phase 40: Performance** - Resolve N+1 queries and bound unbounded .collect() calls
- [ ] **Phase 41: Rate Limiting Enforcement** - Activate rate limits on exposed endpoints
- [ ] **Phase 42: Test Coverage** - Test extraction cascade, Zustand migrations, and insight edge cases

Full details: `.planning/milestones/v2.3-ROADMAP.md`

## Phase Details

### Phase 35: Quick Wins & Debug Cleanup
**Goal**: Production codebase is free of debug artifacts, misconfiguration risks, and dead legacy code
**Depends on**: Nothing (first phase of v2.3)
**Requirements**: BUG-01, BUG-02, BUG-03, SEC-02, SEC-03, SEC-04, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. No `console.log` statements exist in billing settings page or OpenAlex server action
  2. `debug_papers.ts` compiles without `@ts-ignore` -- field reference uses correct name (`pdfContentUsed`)
  3. Stripe client initialization uses lazy `getStripe()` pattern that throws only when called with missing key, not at module load
  4. `NEXT_PUBLIC_APP_URL` is validated at function entry in non-dev environments, throwing a clear error if missing
  5. Debug/test functions in `convex/extraction/index.ts` are gated behind `requirePublicDebugEnabled()` and all V32_CUTOVER_AT gating code and one-time backfill mutations are deleted
**Plans**: TBD

### Phase 36: Type Safety Sweep
**Goal**: All Convex context parameters and internal API references use generated types instead of `any` casts
**Depends on**: Phase 35
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05, TYPE-06
**Success Criteria** (what must be TRUE):
  1. Zero `ctx: any` parameters remain in extraction mutations, extraction queries, or workpool actions -- all use `MutationCtx`, `QueryCtx`, or `ActionCtx` from generated types
  2. Zero `internal as any` casts remain across all 7 files (9 locations) -- all use the typed `internal` export from `convex/_generated/api`
  3. Zero `components as any` casts remain -- all use typed component references
  4. `patchData` in extraction mutations is typed as `Partial<Doc<"extractionPapers">>` instead of `any`
  5. Full test suite passes with zero behavior changes (this is a pure annotation change)
**Plans**: TBD

### Phase 37: Schema Additions
**Goal**: Convex schema includes all new tables and fields needed by later phases, deployed as optional fields
**Depends on**: Phase 36
**Requirements**: RATE-01
**Success Criteria** (what must be TRUE):
  1. `rateLimitTables` from `convex-helpers/server/rateLimit` is spread into the Convex schema and the `rateLimits` table exists after deployment
  2. `zoteroConnections` table has new `encryptedApiKey: v.optional(v.string())` and `keyPrefix: v.optional(v.string())` fields alongside the existing `apiKey` field
  3. `npx convex dev` succeeds and all existing functionality is unaffected (no logic changes in this phase)
**Plans**: TBD

### Phase 38: Deletion Cascade & Storage Cleanup
**Goal**: Deleting an extraction job correctly removes all child entities and associated storage with no orphaned records
**Depends on**: Phase 36 (type sweep must be complete before touching extraction/mutations.ts logic)
**Requirements**: DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. Deleting an extraction job removes `extractionEvidenceUnits` for all papers in the job (zero orphaned rows)
  2. Deletion cascade uses `ctx.scheduler.runAfter(0, ...)` batched pattern instead of recursive `ctx.runMutation` -- deletion order is evidence units, then reviews, then results, then papers (with storage cleanup), then questions, then job
  3. Papers with `storageId` that are in `download_failed` or `failed` status have their storage files cleaned up during deletion
  4. Orphaned PDF cleanup covers both job deletion and standalone failed-paper cleanup scenarios
**Plans**: TBD

### Phase 39: Zotero Key Encryption
**Goal**: Zotero API keys are encrypted at rest using the same AES-256-GCM pattern as provider API keys
**Depends on**: Phase 37 (schema must have `encryptedApiKey` field), Phase 38
**Requirements**: SEC-01
**Success Criteria** (what must be TRUE):
  1. New Zotero API key saves encrypt the key with AES-256-GCM before storing, and decrypt on read -- following the existing `convex/apiKeys/actions.ts` pattern
  2. Shared `convex/lib/crypto.ts` module extracts the encrypt/decrypt functions from `apiKeys/actions.ts` for reuse
  3. Existing Zotero connections with plaintext `apiKey` are migrated to `encryptedApiKey` via an idempotent migration action (skips rows already encrypted)
  4. After migration completes, the plaintext `apiKey` field is no longer read or written by any code path
**Plans**: TBD

### Phase 40: Performance
**Goal**: Extraction reporting queries run in parallel instead of sequentially, and unbounded table scans are capped
**Depends on**: Phase 36 (type sweep must be complete before refactoring extraction queries)
**Requirements**: PERF-01, PERF-02, PERF-03
**Success Criteria** (what must be TRUE):
  1. `loadJobDataForReporting` fetches per-paper data using `Promise.all` instead of sequential awaits -- return type and data shape are identical
  2. `loadJobPapersAndResults` fetches per-paper data using `Promise.all` instead of sequential awaits -- return type and data shape are identical
  3. Top unbounded `.collect()` calls (backfill full table scan, active subscription scan) are bounded with `.take(N)` or converted to paginated queries -- reactive UI queries are not affected
**Plans**: TBD

### Phase 41: Rate Limiting Enforcement
**Goal**: Exposed endpoints enforce token-bucket rate limits to prevent abuse
**Depends on**: Phase 37 (schema must have `rateLimits` table)
**Requirements**: RATE-02, RATE-03
**Success Criteria** (what must be TRUE):
  1. Extraction job creation endpoint enforces a rate limit using `convex-helpers/server/rateLimit` -- exceeding the limit returns a clear error
  2. API key save and checkout session creation endpoints enforce rate limits -- exceeding the limit returns a clear error
  3. Rate limit configuration uses `defineRateLimits` from `convex-helpers` with appropriate token-bucket parameters per endpoint
**Plans**: TBD

### Phase 42: Test Coverage
**Goal**: Previously untested subsystems have automated test coverage validating corrected behavior
**Depends on**: Phase 38 (cascade tests must validate corrected implementation), Phase 36
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Extraction cascade delete test creates a full job graph (job + questions + papers + results + reviews + evidence units + storage IDs), deletes the job, and verifies zero orphaned rows remain in any child table
  2. Zustand store migration test verifies a 5-version migration chain -- each version's migrator produces the expected shape from the previous version's state
  3. Extraction insight aggregation test covers edge cases: null answers, missing fields, empty paper sets -- verifying graceful handling without crashes
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 35 -> 36 -> 37 -> 38 -> 39 -> 40 -> 41 -> 42

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 2/2 | Complete | 2026-02-27 |
| 6. UX Polish | v1.1 | 2/2 | Complete | 2026-02-27 |
| 7. Test Infrastructure Foundation | v1.2 | 3/3 | Complete | 2026-02-28 |
| 8. Subscription and Upgrade Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 9. Lifecycle and Credit Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 10. Fix Credits Spec Auth Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 11. Tech Debt Cleanup | v1.2 | 1/1 | Complete | 2026-02-28 |
| 12. Billing E2E CI Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 13. CI Env Hardening & CRED-02 Regression | v1.2 | 1/1 | Complete | 2026-02-28 |
| 14. Test Infrastructure | v2.0 | 1/1 | Complete | 2026-02-28 |
| 15. AI Prompts & Schema Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 16. AI Batch Processing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 17. AI Cost & Billing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 18. Search & Filter Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 19. Data Export Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 20. User Auth & State Machine Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 21. Plan Enforcement & Feature Gating Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 22. Schema & Rating Bridge | v2.1 | 2/2 | Complete | 2026-02-28 |
| 23. Core Library Page | v2.1 | 2/2 | Complete | 2026-02-28 |
| 24. Advanced Filtering & URL State | v2.1 | 2/2 | Complete | 2026-02-28 |
| 25. Collections | v2.1 | 3/3 | Complete | 2026-03-01 |
| 26. Export & Polish | v2.1 | -- | Superseded | - |
| 27. Library UI Redesign | v2.1 | 2/2 | Complete | 2026-03-01 |
| 28. Bug Fixes & Verification | v2.1 | 2/2 | Complete | 2026-03-01 |
| 29. Library Export | v2.1 | 1/1 | Complete | 2026-03-01 |
| 30. Library Polish | v2.1 | 1/1 | Complete | 2026-03-01 |
| 31. Generalized Layout Infrastructure | v2.2 | 2/2 | Complete | 2026-03-01 |
| 32. Search Page Sidebar Refactor | v2.2 | 1/1 | Complete | 2026-03-01 |
| 33. Library Page UI Overhaul | v2.2 | 2/2 | Complete | 2026-03-01 |
| 34. Display Polish and Validation | v2.2 | 2/2 | Complete | 2026-03-01 |
| 35. Quick Wins & Debug Cleanup | 3/3 | Complete    | 2026-03-02 | - |
| 36. Type Safety Sweep | 2/2 | Complete   | 2026-03-02 | - |
| 37. Schema Additions | v2.3 | 0/TBD | Not started | - |
| 38. Deletion Cascade & Storage Cleanup | v2.3 | 0/TBD | Not started | - |
| 39. Zotero Key Encryption | v2.3 | 0/TBD | Not started | - |
| 40. Performance | v2.3 | 0/TBD | Not started | - |
| 41. Rate Limiting Enforcement | v2.3 | 0/TBD | Not started | - |
| 42. Test Coverage | v2.3 | 0/TBD | Not started | - |
