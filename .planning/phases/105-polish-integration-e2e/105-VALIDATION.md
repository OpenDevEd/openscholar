---
phase: 105
slug: polish-integration-e2e
status: final
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-16
---

# Phase 105 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x + playwright 1.x + eslint 10.x |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs` (NEW, Plan 01) |
| **Quick run command** | `npm run test -- tests/extraction/lint-rule.test.ts tests/i18n/v7-key-parity.test.ts --run` |
| **Full suite command** | `npm run test:ci` (lint + vitest + build + e2e:auth + e2e:workbench) |
| **Estimated runtime** | ~180 seconds full (~5s quick) |

---

## Sampling Rate

- **After every task commit:** Run the task's own `<automated>` verify command from its PLAN (grep assertions + targeted test)
- **After every plan wave:** Run `npm run test && npm run lint` to catch cross-task regressions
- **Before `/gsd-verify-work`:** Full suite must be green — `npm run test:ci`
- **Max feedback latency:** 90 seconds for quick commands; 180 seconds for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement / SC | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 105-01-01 | 01 | 1 | GAP-03 / SC-1 | `eslint.config.mjs` rule bans literal `1000` / `200` in extraction UI | lint (config) | `npx eslint components/extraction --no-warn-ignored --max-warnings=0` against a fixture | ⬜ pending |
| 105-01-02 | 01 | 1 | GAP-03 / SC-1 | Rule survives in CI via structural self-test | unit (eslint programmatic) | `npm run test -- tests/extraction/lint-rule.test.ts --run` | ⬜ pending |
| 105-02-01 | 02 | 1 | SC-4 | `<MotionConfig reducedMotion="user">` wraps root layout | grep + tsc | `grep -q "MotionConfig" app/layout.tsx && npx tsc --noEmit` | ⬜ pending |
| 105-02-02 | 02 | 1 | SC-3 | `useIsMobile()` hides card/split at <768px; toast key renamed | grep + tsc | `grep -q "useIsMobile" components/extraction/view-switcher.tsx && npx tsc --noEmit` | ⬜ pending |
| 105-02-03 | 02 | 1 | SC-3 | `min-h-[44px]` on v7.0 interactive buttons; `@media (prefers-reduced-motion)` rule in globals.css; TabsList uses `overflow-x-auto`; basket drawer is `w-full sm:max-w-md` | grep + tsc | grep count assertions across `components/extraction/` + `app/extraction/**` + `app/globals.css` + `npx tsc --noEmit` | ⬜ pending |
| 105-03-01 | 03 | 2 | SC-5 | All 6 locales share identical key set; 8-10 curated French keys contain diacritics | vitest | `npm run test -- tests/i18n/v7-key-parity.test.ts --run` | ⬜ pending |
| 105-03-02 | 03 | 2 | SC-2 (setup) | `seedCompletedJob` internalAction dev-guarded (NODE_ENV/CONVEX_CLOUD_URL/ALLOW_TEST_SEEDING) | grep + codegen + tsc | `grep -q "seedCompletedJob" convex/extraction/testing.ts && npx convex codegen && npx tsc --noEmit` | ⬜ pending |
| 105-03-03 | 03 | 2 | SC-2 + SC-4 (assertion) | Full v7.0 flow: stage → counter → job → 3 views → exports; reduced-motion assertion <150ms | playwright | `npm run test:e2e:workbench` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note:** SC-3 mobile responsive behavior and SC-4 reduced-motion behavior are verified via (a) unit-level grep + tsc assertions on the source files modified in Plan 02, and (b) the E2E spec in Plan 03 Task 3 (`emulateMedia({reducedMotion: 'reduce'})` + view-switch duration assertion). No standalone component unit tests are planned for Plan 02 — the grep + tsc chain plus the E2E coverage meet the Nyquist threshold of at least one automated check per phase success criterion.

---

## Wave 0 Requirements

All validation scaffolds are created by the plans themselves; no separate Wave 0 is required beyond what Plans 01 + 02 + 03 deliver:

- [ ] `eslint.config.mjs` — ESLint flat config at repo root (Plan 01 Task 1)
- [ ] `tests/extraction/lint-rule.test.ts` — ESLint programmatic self-test (Plan 01 Task 2)
- [ ] `tests/i18n/v7-key-parity.test.ts` — locale key parity + diacritic sampling (Plan 03 Task 1)
- [ ] `convex/extraction/testing.ts` — dev-guarded `seedCompletedJob` internalAction (Plan 03 Task 2)
- [ ] `e2e/helpers/sign-in.ts` — extracted Clerk sign-in helper (Plan 03 Task 3)
- [ ] `e2e/extraction-workbench.spec.ts` — full v7.0 E2E spec (Plan 03 Task 3)
- [ ] `e2e/fixtures/zotero-collections.json` + `e2e/fixtures/zotero-items.json` — mock Zotero payloads (Plan 03 Task 3)

---

## Manual-Only Verifications

| Behavior | Success Criterion | Why Manual | Test Instructions |
|----------|-------------------|------------|-------------------|
| Real Zotero OAuth round-trip | SC-2 (partial) | E2E mocks Zotero via `page.route` — live OAuth is covered by manual UAT | UAT: connect a real Zotero account in dev, verify library listing appears |
| Real LLM extraction cascade | SC-2 (partial) | E2E seeds completed job via CLI shell-out — real cascade takes 1-2 min/paper and is covered by the extraction unit suite | UAT: create a real extraction job with 2-3 papers and verify results render |
| Mobile physical-device touch targets | SC-3 (partial) | 44px is a className assertion; physical tap ergonomics need human verification | UAT: open `/extraction/new` on a real phone, tap every CTA |
| Visual quality of reduced-motion fallback | SC-4 (partial) | `<150ms` assertion proves animation skipped; aesthetic quality (no jarring snaps) needs human eye | UAT: enable reduced-motion in OS settings, navigate workbench |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (via plan `<automated>` blocks)
- [x] Sampling continuity: every task has a verify; no 3-consecutive-task gaps
- [x] Wave 0 covers all MISSING references (listed above; all created by Plan 01/02/03)
- [x] No watch-mode flags
- [x] Feedback latency < 90s for quick commands, < 180s for full suite
- [x] `nyquist_compliant: true` set in frontmatter (reconciled with actual plan deliverables — no phantom unit tests)

**Approval:** approved 2026-04-16
