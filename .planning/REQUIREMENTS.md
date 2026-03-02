# Requirements: OpenAlex Count

**Defined:** 2026-03-02
**Core Value:** Reliable, well-tested academic search and AI extraction

## v2.3 Requirements

Requirements for codebase hardening milestone. Each maps to roadmap phases.

### Bug Fixes

- [ ] **BUG-01**: Debug console.log removed from billing settings page
- [ ] **BUG-02**: Debug console.log removed from OpenAlex server action
- [ ] **BUG-03**: @ts-ignore removed from debug_papers.ts with proper typing or field removal

### Type Safety

- [ ] **TYPE-01**: `ctx: any` replaced with `MutationCtx` in extraction mutations
- [ ] **TYPE-02**: `ctx: any` replaced with `QueryCtx` in extraction queries
- [ ] **TYPE-03**: `ctx: any` replaced with proper context types in workpoolActions
- [ ] **TYPE-04**: `internal as any` casts removed across all 7 files (9 locations)
- [ ] **TYPE-05**: `components as any` casts removed
- [ ] **TYPE-06**: `patchData: any` typed as `Partial<Doc<"extractionPapers">>`

### Security

- [ ] **SEC-01**: Zotero API key encrypted with AES-256-GCM (matching apiKeys pattern)
- [ ] **SEC-02**: Stripe "dummy" key fallback replaced with lazy init that throws on missing key
- [ ] **SEC-03**: `NEXT_PUBLIC_APP_URL` validated — throws if missing in non-dev environments
- [ ] **SEC-04**: Debug/test functions in production audited and isolated behind gate

### Data Integrity

- [ ] **DATA-01**: Deletion cascade includes `extractionEvidenceUnits` cleanup
- [ ] **DATA-02**: Recursive `runMutation` replaced with `scheduler.runAfter(0)` batched deletion
- [ ] **DATA-03**: Orphaned PDF storage cleanup covers failed papers and deleted jobs
- [ ] **DATA-04**: V32_CUTOVER_AT version gating code deleted entirely
- [ ] **DATA-05**: One-time backfill mutations deleted (backfillIsIndexed and similar)

### Performance

- [ ] **PERF-01**: N+1 in `loadJobDataForReporting` resolved with `Promise.all`
- [ ] **PERF-02**: N+1 in `loadJobPapersAndResults` resolved with `Promise.all`
- [ ] **PERF-03**: Unbounded `.collect()` calls bounded with `.take(N)` or pagination

### Rate Limiting

- [ ] **RATE-01**: `rateLimitTables` added to Convex schema
- [ ] **RATE-02**: Rate limits enforced on extraction job creation
- [ ] **RATE-03**: Rate limits enforced on other exposed endpoints (API key saves, checkout sessions)

### Test Coverage

- [ ] **TEST-01**: Extraction cascade delete tested (including evidence units and storage)
- [ ] **TEST-02**: Zustand store migration paths tested (5-version chain)
- [ ] **TEST-03**: Extraction insight aggregation edge cases tested (null answers, missing fields)

## Future Requirements

### Extraction E2E Tests

- **E2E-01**: End-to-end Playwright tests for extraction workflow (job creation through results display)

### Scaling

- **SCALE-01**: Paginate extraction dashboard queries for large jobs (500+ papers)
- **SCALE-02**: Move search history from localStorage to Convex backend

### Dependencies

- **DEP-01**: Evaluate replacing @sickrin/openalex-sdk with direct fetch calls

## Out of Scope

| Feature | Reason |
|---------|--------|
| Extraction E2E tests | Deferred — requires stable extraction workflow first |
| V32_CUTOVER_AT migration to schema field | Pre-production build — delete entirely instead of migrating |
| Backfill mutation fixes | Pre-production build — delete entirely instead of fixing |
| Search history migration to backend | Separate scaling milestone |
| localStorage pruning logic | Separate scaling milestone |
| Multiple subscription row dedup | Partially covered by existing selectCanonicalSubscription |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUG-01 | — | Pending |
| BUG-02 | — | Pending |
| BUG-03 | — | Pending |
| TYPE-01 | — | Pending |
| TYPE-02 | — | Pending |
| TYPE-03 | — | Pending |
| TYPE-04 | — | Pending |
| TYPE-05 | — | Pending |
| TYPE-06 | — | Pending |
| SEC-01 | — | Pending |
| SEC-02 | — | Pending |
| SEC-03 | — | Pending |
| SEC-04 | — | Pending |
| DATA-01 | — | Pending |
| DATA-02 | — | Pending |
| DATA-03 | — | Pending |
| DATA-04 | — | Pending |
| DATA-05 | — | Pending |
| PERF-01 | — | Pending |
| PERF-02 | — | Pending |
| PERF-03 | — | Pending |
| RATE-01 | — | Pending |
| RATE-02 | — | Pending |
| RATE-03 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |

**Coverage:**
- v2.3 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27 (pending roadmap creation)

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*
