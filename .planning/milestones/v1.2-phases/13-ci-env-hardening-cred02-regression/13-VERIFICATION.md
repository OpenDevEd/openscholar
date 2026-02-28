---
phase: 13-ci-env-hardening-cred02-regression
status: passed
verified: 2026-02-28
verifier: orchestrator-inline
---

# Phase 13: CI Env Hardening & CRED-02 Regression -- Verification

## Goal
Eliminate CI env fragility by setting explicit CLERK_PUBLISHABLE_KEY in billing jobs, and add a dedicated CRED-02 regression test for monthly credit grants.

## Requirements Verified

### INFRA-02: CI Env Hardening

| Check | Status |
|-------|--------|
| billing-live env block has CLERK_PUBLISHABLE_KEY | PASS (ci.yml line 126) |
| billing-live-extended env block has CLERK_PUBLISHABLE_KEY | PASS (ci.yml line 213) |
| billing-live-extended-nightly env block has CLERK_PUBLISHABLE_KEY | PASS (billing-nightly.yml line 28) |
| CLERK_PUBLISHABLE_KEY sourced from secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | PASS (all 3 blocks) |
| Pattern matches existing e2e-auth job (ci.yml lines 41-42) | PASS |

### CRED-02: Monthly Credit Grant Regression Test

| Check | Status |
|-------|--------|
| credit-grants.spec.ts exists at e2e/billing/specs/ | PASS |
| test.describe("CRED-02: Monthly Credit Grants") block present | PASS |
| Go test asserts toBe(5_000) (exact match) | PASS |
| Pro test asserts toBe(17_000) (exact match) | PASS |
| Imports createSubscriptionBypass from stripe-helpers | PASS |
| Imports cleanupStripeCustomer from stripe-helpers | PASS |
| No pricingPage fixture used (credit-only focus) | PASS |
| No plan name or status badge assertions | PASS |

### Negative Checks

| Check | Status |
|-------|--------|
| subscribe.spec.ts unmodified | PASS (git diff confirms zero changes) |
| credits.spec.ts unmodified | PASS |
| No new dependencies added | PASS |

## Must-Have Truths Verified

1. "All three billing CI jobs set CLERK_PUBLISHABLE_KEY explicitly alongside NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" -- **VERIFIED**: ci.yml has 6 total CLERK_PUBLISHABLE_KEY occurrences (3 NEXT_PUBLIC_ + 3 explicit), billing-nightly.yml has 2 (1 NEXT_PUBLIC_ + 1 explicit)

2. "A dedicated test asserts Go subscription grants exactly 5,000 total credits (2,000 free + 3,000 monthly)" -- **VERIFIED**: `expect(credits).toBe(5_000)` in credit-grants.spec.ts

3. "A dedicated test asserts Pro subscription grants exactly 17,000 total credits (2,000 free + 15,000 monthly)" -- **VERIFIED**: `expect(credits).toBe(17_000)` in credit-grants.spec.ts

## Score

**7/7 must-haves verified. 3/3 negative checks passed.**

## Result: PASSED
