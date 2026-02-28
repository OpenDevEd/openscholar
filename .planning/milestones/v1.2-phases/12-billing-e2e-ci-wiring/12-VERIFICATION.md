---
phase: 12-billing-e2e-ci-wiring
verified: 2026-02-28T09:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 12: Billing E2E CI Wiring — Verification Report

**Phase Goal:** Wire Playwright billing E2E tests into CI pipelines — add npm script, env vars, browser install, test execution, and artifact upload to billing-live, billing-live-extended, and billing-live-extended-nightly jobs.
**Verified:** 2026-02-28T09:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                          | Status     | Evidence                                                                                 |
|----|----------------------------------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------|
| 1  | package.json contains a test:billing:e2e script that runs playwright test --project=billing                   | VERIFIED   | Line 18: `"test:billing:e2e": "playwright test --project=billing"`                       |
| 2  | billing-live CI job includes CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, and all 7 env vars          | VERIFIED   | ci.yml lines 124-130: all 7 vars present with secrets references                        |
| 3  | billing-live-extended CI job includes the same Clerk/Playwright env vars                                       | VERIFIED   | ci.yml lines 210-216: identical 7-var block with secrets references                     |
| 4  | billing-live-extended-nightly CI job includes the same Clerk/Playwright env vars                               | VERIFIED   | billing-nightly.yml lines 26-32: identical 7-var block with secrets references          |
| 5  | All three billing CI jobs have an Install Playwright browser step                                              | VERIFIED   | ci.yml lines 176-177, 246-247; billing-nightly.yml lines 78-79                          |
| 6  | All three billing CI jobs have a Run billing E2E tests step using npm run test:billing:e2e                     | VERIFIED   | ci.yml lines 179-180, 249-250; billing-nightly.yml lines 81-82                          |
| 7  | All three billing CI jobs have an Upload billing E2E report step with artifact upload                          | VERIFIED   | ci.yml lines 182-188, 252-258; billing-nightly.yml lines 84-90; all use github.job name |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact                                | Expected                                                       | Status   | Details                                                                                       |
|-----------------------------------------|----------------------------------------------------------------|----------|-----------------------------------------------------------------------------------------------|
| `package.json`                          | Contains test:billing:e2e npm script                           | VERIFIED | Line 18: exact expected value `"playwright test --project=billing"`                           |
| `.github/workflows/ci.yml`             | Billing E2E wiring in billing-live and billing-live-extended   | VERIFIED | Both jobs fully wired: env vars, browser install, E2E run, artifact upload                   |
| `.github/workflows/billing-nightly.yml`| Billing E2E wiring in billing-live-extended-nightly            | VERIFIED | Job fully wired: env vars, browser install, E2E run, artifact upload                         |

---

### Key Link Verification

| From                                    | To             | Via                            | Status | Details                                                            |
|-----------------------------------------|----------------|--------------------------------|--------|--------------------------------------------------------------------|
| `.github/workflows/ci.yml`             | `package.json` | npm run test:billing:e2e       | WIRED  | Script invocation at ci.yml lines 180 and 250; script exists at package.json line 18 |
| `.github/workflows/billing-nightly.yml`| `package.json` | npm run test:billing:e2e       | WIRED  | Script invocation at billing-nightly.yml line 82; script exists at package.json line 18 |
| `package.json test:billing:e2e`        | `playwright.config.ts` | --project=billing flag    | WIRED  | playwright.config.ts line 69: `name: "billing"` project defined with testDir ./e2e/billing |

---

### Requirements Coverage

No requirement IDs were declared for this phase (CI operational wiring, not product requirements). `requirements: []` in PLAN frontmatter. No entries in REQUIREMENTS.md map to Phase 12.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.github/workflows/ci.yml` | 14-15 | `pk_test_placeholder` / `sk_test_placeholder` | Info | Pre-existing placeholder values in the `unit-and-build` job (not a billing job). Expected — unit-and-build only needs Clerk vars for the Next.js build, not real keys. Not introduced by this phase. |

No anti-patterns introduced by Phase 12. The placeholder values at lines 14-15 predate this phase and are intentional for the build-only CI job.

---

### Structural Compliance Notes

- `continue-on-error: true` is set at the **job level** for `billing-live-extended` only (ci.yml line 195). No individual E2E steps carry `continue-on-error` in any billing job. This matches the PLAN requirement exactly.
- Artifact names use `${{ github.job }}` suffix in all three jobs, preventing collision when multiple billing jobs run in the same workflow run.
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` are set as static values (`/sign-in`, `/sign-up`) in billing jobs rather than secrets — correct, as these are non-secret static routes.
- `billing-live-extended` retains its `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` condition. The E2E step inherits this trigger. Correct — no change made to job-level triggers.

---

### Human Verification Required

None. All wiring is in static CI YAML and package.json — fully verifiable via code inspection. The E2E tests themselves would require a live Clerk/Stripe/Convex environment to confirm runtime correctness, but the CI wiring phase goal (adding scripts, env vars, steps, and artifact upload) is fully verified programmatically.

---

### Commits Verified

| Commit  | Message                                                            | Status   |
|---------|--------------------------------------------------------------------|----------|
| 6dffdcd | feat(12-01): add test:billing:e2e npm script                       | EXISTS   |
| 56a9959 | feat(12-01): wire billing E2E into all three billing CI jobs       | EXISTS   |

Both commits referenced in SUMMARY exist in the repository's git history.

---

### Summary

Phase 12 achieved its goal completely. All seven must-have truths are verified against the actual codebase:

1. The `test:billing:e2e` npm script is present in `package.json` with the exact value `playwright test --project=billing`.
2. All three billing CI jobs (`billing-live`, `billing-live-extended`, `billing-live-extended-nightly`) contain the required seven environment variables: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, and `E2E_BASE_URL`.
3. All three jobs have the `Install Playwright browser` step (`npx playwright install --with-deps chromium`).
4. All three jobs have the `Run billing E2E tests` step (`npm run test:billing:e2e`).
5. All three jobs have the `Upload billing E2E report` step using `actions/upload-artifact@v4` with job-unique names via `${{ github.job }}`.

The `--project=billing` flag correctly targets the named billing project in `playwright.config.ts`, which applies the configured timeout (180s), workers (1), and locale (en-US). No stubs, orphaned code, or broken wiring were found.

---

_Verified: 2026-02-28T09:00:00Z_
_Verifier: Claude (gsd-verifier)_
