# Requirements: OpenAlex Count

**Defined:** 2026-03-02
**Core Value:** Reliable, well-tested academic search and AI extraction

## v2.4 Requirements

Requirements for v2.4 Concerns Sweep. Each maps to roadmap phases.

### Security & Compliance

- [ ] **SEC-01**: Migrate all plaintext Zotero `apiKey` values to `encryptedApiKey` via one-time batched action
- [ ] **SEC-02**: Remove deprecated `apiKey` field from schema and all fallback code paths after migration verification
- [ ] **SEC-03**: Extend `cleanupDeletedUsers` to cascade-delete extraction jobs, papers, results, evidence units, and Zotero connections for deleted users
- [ ] **SEC-04**: Document debug endpoint production policy with inline JSDoc and deployment checklist
- [ ] **SEC-05**: Remove orphaned `/test-sidebar` page from production build

### Data Integrity & Bugs

- [ ] **BUG-01**: Fix `cancelExtraction` to call `workflow.cancel()` and per-paper `pdfProcessingPool.cancel()` with credit-guard in workpool action
- [ ] **BUG-02**: Remove `.take(100)` cap in `getJobDetails` — replace with `.collect()` (bounded by ~200-paper job cap)
- [ ] **BUG-03**: Fix `deleteExtractionInternal` to also delete `extractionRunDiffs` where `baselineJobId == args.jobId` (Step 8b)
- [ ] **BUG-04**: Add `isTruncated` and `totalChanges` fields to `extractionRunDiffs` when changes exceed cap, surface in UI
- [ ] **BUG-05**: Replace placeholder `admin@example.com` in OpenAlex User-Agent with real operational email

### Type Safety

- [ ] **TYPE-01**: Create shared `convex/extraction/validators.ts` with typed validator objects for extraction document shapes
- [ ] **TYPE-02**: Replace `v.any()` return validators in 7 extraction queries with typed validators from TYPE-01
- [ ] **TYPE-03**: Replace `Map<string, any>` and `review: any` in `attachReviewMetadata` with `Doc<"extractionResultReviews">`
- [ ] **TYPE-04**: Add typed migration input/output shapes for all 7 `migrateSearchHistoryState` version steps

### Cron & Cleanup

- [ ] **CRON-01**: Add cron job to delete expired `zoteroOAuthTokens` where `expiresAt < Date.now()`

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Performance

- **PERF-01**: Pre-fetch all reviews for a job in a single indexed query to eliminate N+1 in `loadJobPapersAndResults`
- **PERF-02**: Add server-side streaming/chunked export to replace unbounded `getJobResults` .collect()
- **PERF-03**: Split `convex/extraction/mutations.ts` (2,026 lines) into domain-specific files

### Scaling

- **SCALE-01**: Implement multi-page pagination in `fetchPapersFromHistory` beyond 200-paper OpenAlex limit
- **SCALE-02**: Paginate `checkSubscriptionStatus` cron with cursor-based approach for thousands of subscribers

### Fragile Areas

- **FRAG-01**: Add retry tracking and completion signal to cascade delete self-scheduling
- **FRAG-02**: Consolidate Stripe singleton into single `convex/stripe.ts` import
- **FRAG-03**: Centralise feature flag reads into single registry module per runtime

### Dependencies

- **DEP-01**: Centralise Stripe API version in `convex/stripe.ts` for single-point updates

### Test Coverage

- **TEST-01**: Test that extraction cancellation actually stops workflow and prevents credit deduction
- **TEST-02**: Test RAG vector cleanup on job deletion
- **TEST-03**: Performance/load test for `getJobInsights`/`getJobResults` on 200-paper jobs

## Out of Scope

| Feature | Reason |
|---------|--------|
| `NEXT_PUBLIC_` feature flag renaming | Intentional — enables frontend/backend file portability |
| RAG index cleanup on paper deletion | Missing feature, not a concern fix — v3+ scope |
| Webhook for extraction job completion | Missing feature, not a concern fix — v3+ scope |
| Full pagination for `getJobResults` | Performance improvement, not a bug — deferred |
| `mutations.ts` file splitting | Refactoring, not a concern fix — deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | — | Pending |
| SEC-02 | — | Pending |
| SEC-03 | — | Pending |
| SEC-04 | — | Pending |
| SEC-05 | — | Pending |
| BUG-01 | — | Pending |
| BUG-02 | — | Pending |
| BUG-03 | — | Pending |
| BUG-04 | — | Pending |
| BUG-05 | — | Pending |
| TYPE-01 | — | Pending |
| TYPE-02 | — | Pending |
| TYPE-03 | — | Pending |
| TYPE-04 | — | Pending |
| CRON-01 | — | Pending |

**Coverage:**
- v2.4 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15 ⚠️

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*
