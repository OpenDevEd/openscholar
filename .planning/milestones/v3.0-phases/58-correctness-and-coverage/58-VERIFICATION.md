---
phase: 58-correctness-and-coverage
verified: 2026-03-04T07:45:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 58: Correctness and Coverage Verification Report

**Phase Goal:** Prove credit deduction concurrency safety, eliminate silent OpenAlex email fallback, test subscription cron correction with both Stripe customer shapes, and test GROBID URL discovery fallback chain.
**Verified:** 2026-03-04T07:45:00Z
**Status:** passed
**Re-verification:** No -- initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `describe("concurrency")` block in `deduct-credits.test.ts` fires concurrent mutations via `Promise.allSettled` and asserts final balance is never negative | VERIFIED | Lines 202-294 of `deduct-credits.test.ts`; 9 tests pass including 3 concurrency cases |
| 2 | Concurrent deductions with sufficient balance: at most `floor(balance/amount)` succeed, rest fail with `INSUFFICIENT_CREDITS`, balance >= 0 | VERIFIED | Test "OCC prevents negative balances under concurrent deductions" (lines 207-244) |
| 3 | Concurrent deductions with insufficient balance race: some fail, balance never goes negative | VERIFIED | Test "all deductions fail when each exceeds total balance" (lines 246-268) |
| 4 | OpenAlex API call throws when `OPENALEX_CONTACT_EMAIL` env var is absent -- no silent `admin@example.com` fallback | VERIFIED | `convex/extraction/actions.ts` lines 137-143; `grep admin@example.com` returns no matches |
| 5 | Test proves missing `OPENALEX_CONTACT_EMAIL` causes a throw with descriptive error message | VERIFIED | `tests/openalex-email.test.ts` lines 15-30; 2 tests pass |
| 6 | `checkSubscriptionStatus` test covers expanded customer object (`{id: 'cus_xxx', ...}`) and verifies correction path | VERIFIED | `convex/maintenance/check-subscription.test.ts` lines 112-152; test passes |
| 7 | `checkSubscriptionStatus` test covers string customer ID (`'cus_xxx'`) and verifies correction path | VERIFIED | `convex/maintenance/check-subscription.test.ts` lines 71-110; test passes |
| 8 | GROBID URL discovery fallback test: when all endpoints fail, `processFulltextDocumentWithGrobid` throws descriptive error listing attempted URLs | VERIFIED | `tests/grobid-fallback.test.ts` lines 25-45; 3 fetch calls confirmed, error message contains "GROBID parsing failed across" |
| 9 | GROBID URL discovery fallback test: when first endpoint fails and second succeeds, function returns the successful result | VERIFIED | `tests/grobid-fallback.test.ts` lines 47-89; result contains `teiXml`, `title`, and `blocks` |

**Score:** 9/9 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/credits/deduct-credits.test.ts` | Concurrency invariant tests proving OCC prevents negative balances | VERIFIED | 294 lines; `describe("concurrency")` block at line 202 with 3 test cases using `Promise.allSettled` |
| `convex/extraction/actions.ts` | Fail-loud validation for `OPENALEX_CONTACT_EMAIL` at point of use | VERIFIED | Lines 137-143: explicit `if (!contactEmail) throw` with message "OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard." |
| `tests/openalex-email.test.ts` | Test for OpenAlex email env var validation | VERIFIED | 43 lines; covers missing env var (throws) and present env var (uses correct email) |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/maintenance/check-subscription.test.ts` | Subscription cron correction test with both customer object shapes | VERIFIED | 195 lines; 3 tests: string customer ID, expanded customer object, no-divergence case |
| `tests/grobid-fallback.test.ts` | GROBID URL fallback chain test covering failure and recovery paths | VERIFIED | 110 lines; 3 tests: all-fail, first-fail-second-succeed, explicit baseUrl priority |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `deduct-credits.test.ts` concurrency block | `convex/credits/internal.ts deductCredits` | `Promise.allSettled` with `t.mutation()` | WIRED | Lines 213-220 fire 8 concurrent mutations; `Promise.allSettled` at line 220 |
| `convex/extraction/actions.ts fetchPapersFromHistory` | `process.env.OPENALEX_CONTACT_EMAIL` | Validation throw before fetch call | WIRED | Lines 138-143: reads env var, throws if falsy, uses in `User-Agent` header at line 147 |
| `convex/maintenance/check-subscription.test.ts` | `convex/maintenance/internal.ts checkSubscriptionStatus` | `t.action()` with mocked Stripe | WIRED | Lines 101, 145, 188 call `t.action(internal.maintenance.internal.checkSubscriptionStatus, {})` |
| `tests/grobid-fallback.test.ts` | `convex/extraction/grobid.ts processFulltextDocumentWithGrobid` | `vi.stubGlobal('fetch')` + dynamic import | WIRED | `vi.stubGlobal("fetch", mockFetch)` at line 9; dynamic import at lines 27-29; function called at line 37 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CORR-01 | Plan 01 | Add concurrency invariant test for credit deduction verifying Convex OCC prevents negative balances | SATISFIED | `describe("concurrency")` block with 3 tests; all pass; 9 tests total in file |
| CORR-02 | Plan 01 | Fix OpenAlex polite pool fallback -- fail loudly instead of `admin@example.com` default | SATISFIED | `admin@example.com` removed; fail-loud throw present at lines 139-143; test coverage in `tests/openalex-email.test.ts` |
| CORR-03 | Plan 02 | Add test for `checkSubscriptionStatus` cron correction path covering both customer object shapes | SATISFIED | Both string and expanded object cases tested; `syncSubscription` triggered via divergence detection; plan updated in DB verified |
| TEST-02 | Plan 02 | Add test for GROBID URL discovery fallback chain when `GROBID_URL` is absent and endpoints fail | SATISFIED | 3 tests covering all-fail, partial-fail-recovery, and explicit URL priority; `vi.stubGlobal` intercepts all fetch calls |

**All 4 requirements satisfied. No orphaned requirements -- REQUIREMENTS.md traceability table lists only CORR-01, CORR-02, CORR-03, TEST-02 for Phase 58.**

---

### Test Run Results

All tests executed and passed:

| Test File | Tests | Result |
|-----------|-------|--------|
| `convex/credits/deduct-credits.test.ts` | 9 (4 existing + 3 concurrency new + 2 sequential) | PASSED in 87ms |
| `tests/openalex-email.test.ts` | 2 | PASSED in 2ms |
| `convex/maintenance/check-subscription.test.ts` | 3 | PASSED in 44ms |
| `tests/grobid-fallback.test.ts` | 3 | PASSED in 116ms |

---

### Commit Verification

All 4 commits documented in summaries exist and match claimed content:

| Commit | Plan | Content |
|--------|------|---------|
| `34fbabd` | 01 | `test(58-01): add concurrency invariant tests for deductCredits` |
| `faa66ee` | 01 | `feat(58-01): replace OpenAlex silent email fallback with fail-loud validation` |
| `be6ad26` | 02 | `test(58-02): add subscription cron correction test with both customer shapes` |
| `3bf4bdc` | 02 | `test(58-02): add GROBID URL discovery fallback chain test` |

---

### Anti-Patterns Found

None. Scanned all 5 phase files for TODO/FIXME/HACK/placeholder/return null patterns -- no anti-patterns detected.

---

### Human Verification Required

None. All phase goals are fully verifiable programmatically:

- Concurrency tests: run with `npx vitest run` and pass
- Silent fallback elimination: confirmed via grep
- Subscription correction: test exercises actual `checkSubscriptionStatus` action via `t.action()` against real in-memory Convex DB
- GROBID fallback: test exercises actual `processFulltextDocumentWithGrobid` with stubbed fetch

---

### Production Code Changes Summary

Phase 58 involved one production code change and four new test files:

**Production change (CORR-02):** `convex/extraction/actions.ts` -- replaced `process.env.OPENALEX_CONTACT_EMAIL ?? "admin@example.com"` with an explicit validation throw. The fail-loud pattern is correctly implemented: env var is read into `contactEmail`, a guard throws if falsy, and the validated variable is used in the `User-Agent` header.

**Production code under test (CORR-01):** `convex/credits/internal.ts deductCredits` was NOT modified -- the tests prove the existing OCC implementation is already correct.

**Production code under test (CORR-03):** `convex/maintenance/internal.ts checkSubscriptionStatus` lines 130-133 contain the `typeof fresh.customer === "string" ? fresh.customer : fresh.customer?.id` guard that was added in Phase 56 -- tests prove both branches work correctly.

**Production code under test (TEST-02):** `convex/extraction/grobid.ts processFulltextDocumentWithGrobid` -- GROBID fallback chain logic was already correct; tests prove the error message and recovery behavior.

---

_Verified: 2026-03-04T07:45:00Z_
_Verifier: Claude (gsd-verifier)_
