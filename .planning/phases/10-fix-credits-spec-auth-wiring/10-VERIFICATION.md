---
phase: 10-fix-credits-spec-auth-wiring
verified: 2026-02-28T08:10:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 10: Fix Credits Spec Auth Wiring — Verification Report

**Phase Goal:** Credits E2E tests run with authenticated sessions so signup-credits and credit-cap flows pass instead of timing out
**Verified:** 2026-02-28T08:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                     | Status     | Evidence                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 1   | CRED-01 test destructures `{ clerkUser, billingPage }` so the Clerk session is established before `billingPage.goto()` runs               | VERIFIED   | `credits.spec.ts` line 10: `clerkUser,` present in CRED-01 fixture destructure             |
| 2   | CRED-05 test destructures `{ clerkUser, billingPage }` so the Clerk session is established before `billingPage.goto()` runs               | VERIFIED   | `credits.spec.ts` line 133: `clerkUser,` present in CRED-05 fixture destructure            |
| 3   | Both tests navigate to `/settings/billing` and assert billing content (not perpetual loading skeleton)                                    | VERIFIED   | CRED-01 calls `billingPage.getCreditBalance()` and expects `2_000`; CRED-05 asserts `billingPage.creditCapBanner` is visible — neither assertion is reachable from an unauthenticated page |
| 4   | The `clerkUser` fixture in `fixtures.ts` depends only on `{ page }` and performs sign-in as a side-effect before `billingPage.goto()` runs | VERIFIED   | `fixtures.ts` line 51: `clerkUser: async ({ page }, use)` — no dependency on any other fixture; calls `clerk.signIn()` and navigates to `/settings/billing` before `use()` is called |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact                              | Expected                                              | Status   | Details                                                                                       |
| ------------------------------------- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `e2e/billing/specs/credits.spec.ts`   | Four credits tests with correct fixture wiring on all tests; contains `clerkUser` | VERIFIED | File exists (5,060 bytes, modified 2026-02-28 07:47). All four `test(...)` blocks are substantive. `clerkUser` appears at lines 10, 20, 86, 133 — covers all four tests. |

**Artifact check: Level 1 (exists):** File present at expected path.
**Artifact check: Level 2 (substantive):** 142 lines; four full test implementations with real assertions (`toBe(2_000)`, `toBeVisible()`, proration calculation, topup balance check). No placeholder content.
**Artifact check: Level 3 (wired):** `clerkUser` fixture imported from `../fixtures` and destructured in all four test signatures; `billingPage.goto()` is called in each test body.

---

### Key Link Verification

| From                                    | To                          | Via                                | Status   | Details                                                                                             |
| --------------------------------------- | --------------------------- | ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `credits.spec.ts` CRED-01 test (line 9) | `clerkUser` fixture         | Playwright fixture destructuring   | WIRED    | `clerkUser,` on line 10 is the first parameter in the destructure; `billingPage.goto()` follows on line 14 |
| `credits.spec.ts` CRED-05 test (line 132) | `clerkUser` fixture       | Playwright fixture destructuring   | WIRED    | `clerkUser,` on line 133 is the first parameter in the destructure; `billingPage.goto()` follows on line 139 |

**Note on pattern match:** The PLAN frontmatter specified `pattern: "async \(\{\s*clerkUser"`. The actual file has `async ({` and `clerkUser,` on the next line (multiline form). Single-line grep does not match this pattern, but direct file inspection confirms the fixture destructuring is correct and present. This is a pattern definition issue in the PLAN, not an implementation defect.

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                 | Status    | Evidence                                                                                                     |
| ----------- | ----------- | --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| CRED-01     | 10-01-PLAN  | User receives free signup credits on account creation and sees balance on billing page | SATISFIED | CRED-01 test at line 9 now has `clerkUser` in destructure; test calls `getCreditBalance()` and asserts `2_000` |
| CRED-05     | 10-01-PLAN  | Free-tier user at credit cap sees cap banner on billing page                | SATISFIED | CRED-05 test at line 132 now has `clerkUser` in destructure; test asserts `billingPage.creditCapBanner` is visible |

**Requirements.md traceability:** Both CRED-01 and CRED-05 are listed in `.planning/REQUIREMENTS.md` under the Credits section as `[x]` (complete), with Phase 9 and Phase 10 (gap closure) mapped in the Traceability table. No orphaned requirements for this phase.

---

### Anti-Patterns Found

None. Scan of `e2e/billing/specs/credits.spec.ts` found no TODO, FIXME, placeholder, empty return, or stub patterns.

---

### Human Verification Required

**1. Full credits test suite execution**

**Test:** Run `npx playwright test e2e/billing/specs/credits.spec.ts --project=billing` against a live environment with Clerk and Stripe credentials configured.
**Expected:** 4 passed, 0 failed. CRED-01 ("free user sees 2,000 signup credits") and CRED-05 ("free user at credit cap sees cap banner") no longer time out; they complete in under 30 seconds.
**Why human:** The auth-wiring fix is verified structurally. Runtime correctness (Clerk sign-in succeeding, billing page rendering `billing-plan-name`, credit balance resolving from Convex) requires a live environment with `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, and `CONVEX_DEPLOYMENT_NAME` configured. The test environment is not available to automated verification.

**2. CRED-05 cap banner in CI environment**

**Test:** Confirm `NEXT_PUBLIC_CREDITS_ENABLED` is not set to `'false'` in the CI environment where credits.spec.ts runs.
**Expected:** `creditCapBanner` is visible when a fresh free user's `freeBalance >= freeCreditCap` (2,000 >= 2,000).
**Why human:** The research document (10-RESEARCH.md) flags a secondary risk: if `NEXT_PUBLIC_CREDITS_ENABLED=false` in CI, the cap banner is never rendered regardless of authenticated state. This environment variable cannot be verified programmatically from the codebase alone.

---

### Gaps Summary

No gaps. All four observable truths are verified. The single artifact (`credits.spec.ts`) exists, is substantive, and is correctly wired. Both key links (CRED-01 and CRED-05 fixture destructures) are present in the actual file. Both requirement IDs claimed in the PLAN frontmatter are satisfied and accounted for in REQUIREMENTS.md. No other billing spec files were modified (confirmed by commit diff showing only `credits.spec.ts` changed in commit `5e13c99`).

The phase goal — "Credits E2E tests run with authenticated sessions so signup-credits and credit-cap flows pass instead of timing out" — is structurally achieved. The fixture dependency that caused timeouts (missing `clerkUser` in the destructure of two tests) has been added in both places.

---

_Verified: 2026-02-28T08:10:00Z_
_Verifier: Claude (gsd-verifier)_
