# Requirements: OpenAlex Count

**Defined:** 2026-03-03
**Core Value:** Reliable, well-tested academic search and AI extraction

## v2.5 Requirements

Requirements for v2.5 Tech Debt Purge. Each maps to roadmap phases.

### Type Safety

- [x] **TYPE-01**: Stripe webhook handlers use typed SDK event objects instead of `as any` casts
- [x] **TYPE-02**: Extraction job page uses properly typed Convex ID arguments instead of `as any`
- [x] **TYPE-03**: Paginated extraction results use typed validator instead of `paginationResultValidator(v.any())`
- [x] **TYPE-04**: `searchFilters` schema uses typed Convex validator matching the filter interface
- [x] **TYPE-05**: `encryptedApiKey` is required in schema (not optional) after completed migration
- [x] **TYPE-06**: `continueCursor: "" as any` replaced with proper empty pagination pattern in library queries

### Billing Safety

- [x] **BILL-01**: `getPlanFromPriceId` substring fallback removed; unknown price IDs return `"free"` with warning log
- [x] **BILL-02**: Pending plan change state stored in Convex `subscriptions` table instead of Stripe metadata

### Security

- [x] **SEC-01**: API key decryption centralized into single utility with structured audit logging
- [x] **SEC-02**: Debug/test functions excluded from production builds or isolated behind stronger gate

### Performance

- [ ] **PERF-01**: `loadJobPapersAndResults` batch-loads reviews in single query instead of N+1 per paper
- [ ] **PERF-02**: Per-job `.collect()` calls bounded with `.take()` guards or pagination
- [ ] **PERF-03**: `zoteroOAuthTokens` cleanup uses `by_expiry` index instead of full table scan
- [ ] **PERF-04**: `checkSubscriptionStatus` cron uses composite `by_status_updatedAt` index
- [ ] **PERF-05**: `crypto` module uses normal `import` with `"use node"` directive instead of obfuscation

### Dependencies

- [ ] **DEP-01**: Unused packages removed (ollama, ollama-ai-provider-v2, @ai-sdk/cohere, unpdf)
- [ ] **DEP-02**: `pdfjs-dist` listed as explicit dependency in package.json
- [ ] **DEP-03**: Radix UI packages audited; unused ones removed

### Tests

- [x] **TEST-01**: Stripe webhook handler has dedicated unit tests for event routing and credit grant paths
- [x] **TEST-02**: Concurrent credit deduction race condition tested
- [x] **TEST-03**: `getPlanFromPriceId` substring fallback path tested (before removal in BILL-01)
- [x] **TEST-04**: Extraction cascade deletion partial-failure recovery tested
- [x] **TEST-05**: Debug gate bypass tested -- all debug functions throw FORBIDDEN when env var unset

### Code Organization

- [ ] **ORG-01**: `focus-mode.tsx` decomposed into sub-components (PDF viewer, citation panel, rating controls, etc.)

### Bug Fix

- [ ] **BUG-01**: `OPENALEX_CONTACT_EMAIL` env var set in Convex dashboard (manual action)

## Future Requirements

None -- this milestone is a cleanup sweep.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New user-facing features | Pure tech debt milestone |
| `convex-test` auth-gated function testing | Blocked by convex-test issue #50 |
| OpenAlex pagination beyond 200 papers | Feature work, not tech debt |
| Failed Stripe event auto-retry | New feature, not debt cleanup |
| Mobile app or PWA | Separate initiative |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 48 | Complete |
| TYPE-02 | Phase 49 | Complete |
| TYPE-03 | Phase 49 | Complete |
| TYPE-04 | Phase 49 | Complete |
| TYPE-05 | Phase 50 | Complete |
| TYPE-06 | Phase 49 | Complete |
| BILL-01 | Phase 48 | Complete |
| BILL-02 | Phase 48 | Complete |
| SEC-01 | Phase 50 | Complete |
| SEC-02 | Phase 50 | Complete |
| PERF-01 | Phase 51 | Pending |
| PERF-02 | Phase 51 | Pending |
| PERF-03 | Phase 51 | Pending |
| PERF-04 | Phase 51 | Pending |
| PERF-05 | Phase 51 | Pending |
| DEP-01 | Phase 52 | Pending |
| DEP-02 | Phase 52 | Pending |
| DEP-03 | Phase 52 | Pending |
| TEST-01 | Phase 47 | Complete |
| TEST-02 | Phase 47 | Complete |
| TEST-03 | Phase 47 | Complete |
| TEST-04 | Phase 47 | Complete |
| TEST-05 | Phase 47 | Complete |
| ORG-01 | Phase 52 | Pending |
| BUG-01 | Phase 52 | Pending |

**Coverage:**
- v2.5 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after roadmap creation*
