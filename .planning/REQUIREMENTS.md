# Requirements: OpenAlex Count v3.0

**Defined:** 2026-03-03
**Core Value:** Reliable, well-tested academic search and AI extraction -- zero `any` casts, every concern resolved

## v3.0 Requirements

Requirements for v3.0 Zero-Any Overhaul. Each maps to roadmap phases.

### Type Safety

- [x] **TYPE-01**: Derive `ExtractionResultWithReview` type from `extractionResultWithReviewValidator` and thread through `lib/extraction/export.ts` and `lib/extraction/filtering.ts`, eliminating all `result as any` casts
- [x] **TYPE-02**: Replace `(fresh.customer as any)?.id` in `convex/maintenance/internal.ts` with `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id` pattern
- [x] **TYPE-03**: Replace `name: args.name as any` in `convex/lib/rateLimit.ts` with `v.union(v.literal(...))` validator matching all `defineRateLimits` keys
- [x] **TYPE-04**: Replace `workflow.cancel(ctx, job.workflowId as any)` in `convex/extraction/mutations.ts` with properly typed workflow ID (verify `@convex-dev/workflow` exported type first)
- [x] **TYPE-05**: Delete unused `components/library/library-filters.tsx` dead code file
- [x] **TYPE-06**: Move `getProviderModel` from `lib/ai/client/providers` to `lib/ai/server/` or `lib/ai/core/` to fix module boundary violation
- [x] **TYPE-07**: Verify `convex/test.setup.ts` purpose and either wire into vitest config or delete if orphaned
- [x] **TYPE-08**: Migrate upgrade metadata reading from Stripe subscription object to Convex subscription record in `convex/credits/actions.ts` (BILL-02 follow-up)

### Security

- [x] **SEC-01**: Replace all three `dangerouslySetInnerHTML` call sites in `table-view.tsx` with XSS-safe React-native `HighlightedText` component using text splitting
- [x] **SEC-02**: Create persistent `auditLogs` table in Convex schema with `writeAuditLog` internalMutation, replacing `console.log` audit events for security-sensitive operations
- [x] **SEC-03**: Add startup env var validation for `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN` via cron-based check
- [x] **SEC-04**: Implement debug function production exclusion strategy (separate deployment config or staging-only Convex project documentation)
- [x] **SEC-05**: Replace empty-string fallbacks for Stripe price IDs in `convex/lib/constants.ts` with fail-fast validation in handlers

### Performance

- [x] **PERF-01**: Fix `getLibraryCount` unbounded `.collect()` in `convex/library/queries.ts` with bounded `.take()` or proper count query
- [x] **PERF-02**: Implement incremental extraction report aggregation with `extractionJobStats` table, upsert on paper completion, lazy fallback for existing jobs
- [x] **PERF-03**: Replace static `xlsx` import with dynamic `import('exceljs')` in export handler; migrate from `xlsx` to `exceljs` API
- [x] **PERF-04**: Implement subscription cron batching with cursor-based self-scheduling and 45s circuit-breaker in `convex/subscriptions/internal.ts`
- [x] **PERF-05**: Remove or gate `listAllConnections` migration helper in `convex/zotero/internal.ts` that scans entire `zoteroConnections` table
- [ ] **PERF-06**: Optimize extraction report queries to avoid loading 500 papers x N results in a single mutation context

### Correctness

- [ ] **CORR-01**: Add concurrency invariant test for credit deduction verifying Convex OCC prevents negative balances; implement per-user workpool only if test reveals gap
- [ ] **CORR-02**: Fix OpenAlex polite pool fallback -- fail loudly or use validated env var instead of `admin@example.com` default
- [ ] **CORR-03**: Add test for `checkSubscriptionStatus` cron correction path covering both expanded and non-expanded Stripe customer objects

### Test Coverage

- [x] **TEST-01**: Add unit test for `highlightText` with HTML characters in both text and query parameters verifying XSS safety
- [ ] **TEST-02**: Add test for GROBID URL discovery fallback chain when `GROBID_URL` env var is absent and Docker/localhost variants fail
- [x] **TEST-03**: Add test for rate limiter with invalid name string verifying rejection
- [x] **TEST-04**: Add test for workflow cancel path specifically (not just cascade delete)
- [x] **TEST-05**: Add round-trip ExcelJS export test (generate XLSX, parse back, assert headers and row values)
- [x] **TEST-06**: Add test for env var validation detecting missing critical env vars

## Future Requirements

None -- v3.0 resolves all documented concerns.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Lifting 500-paper cap | Prerequisite (PERF-02 incremental aggregation) ships in v3.0 but cap lift deferred to v3.1 for production validation |
| External SIEM/log sink integration | Convex audit table is sufficient; external integration is infrastructure concern |
| DOMPurify for XSS | React text splitting is simpler, zero-dep, and correct for this use case |
| Module-scope env var validation | Blocks all functions in module; use handler-level or cron-based validation |
| Per-user workpool for ALL credit ops | Over-engineering; only deductCredits callers need serialization if TOCTOU is confirmed |
| Offset-based library pagination | Convex only supports cursor-based; already implemented |
| BILL-02 full Stripe metadata removal | Included as TYPE-08; metadata migration verification is in scope but Stripe metadata backward compat preserved |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 54 | Complete |
| TYPE-02 | Phase 54 | Complete |
| TYPE-03 | Phase 54 | Complete |
| TYPE-04 | Phase 54 | Complete |
| TYPE-05 | Phase 54 | Complete |
| TYPE-06 | Phase 54 | Complete |
| TYPE-07 | Phase 54 | Complete |
| TYPE-08 | Phase 54 | Complete |
| SEC-01 | Phase 55 | Complete |
| SEC-02 | Phase 55 | Complete |
| SEC-03 | Phase 55 | Complete |
| SEC-04 | Phase 55 | Complete |
| SEC-05 | Phase 55 | Complete |
| PERF-01 | Phase 56 | Complete |
| PERF-02 | Phase 57 | Complete |
| PERF-03 | Phase 56 | Complete |
| PERF-04 | Phase 56 | Complete |
| PERF-05 | Phase 56 | Complete |
| PERF-06 | Phase 57 | Pending |
| CORR-01 | Phase 58 | Pending |
| CORR-02 | Phase 58 | Pending |
| CORR-03 | Phase 58 | Pending |
| TEST-01 | Phase 55 | Complete |
| TEST-02 | Phase 58 | Pending |
| TEST-03 | Phase 54 | Complete |
| TEST-04 | Phase 54 | Complete |
| TEST-05 | Phase 56 | Complete |
| TEST-06 | Phase 55 | Complete |

**Coverage:**
- v3.0 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after roadmap creation*
