---
phase: 105
slug: polish-integration-e2e
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 105 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x + playwright 1.x + eslint 9.x |
| **Config file** | vitest.config.ts, playwright.config.ts, eslint.config.mjs (NEW) |
| **Quick run command** | `npm run test -- tests/extraction/lint-rule.test.ts tests/i18n/v7-key-parity.test.ts` |
| **Full suite command** | `npm run test:ci` (includes lint + unit + E2E) |
| **Estimated runtime** | ~90 seconds full (~5s quick) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- {relevant test file}` or `npm run lint`
- **After every plan wave:** Run `npm run test && npm run lint`
- **Before `/gsd-verify-work`:** Full suite must be green — `npm run test:ci`
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 105-01-XX | 01 | 1 | GAP-03 | — | lint rule fires on literal 1000/200 in extraction UI | unit (eslint programmatic) | `npm run test -- tests/extraction/lint-rule.test.ts` | ❌ W0 | ⬜ pending |
| 105-01-XX | 01 | 1 | GAP-03 | — | CI fails on lint error | lint | `npm run lint` | ❌ W0 | ⬜ pending |
| 105-02-XX | 02 | 1 | SC-3 (mobile) | — | view switcher hides card/split <768px | unit (component) | `npm run test -- components/extraction/view-switcher.test.tsx` | ❌ W0 | ⬜ pending |
| 105-02-XX | 02 | 1 | SC-3 (44px) | — | 44px min touch targets on v7.0 buttons | unit (className assertion) | `npm run test -- components/extraction/` | — | ⬜ pending |
| 105-02-XX | 02 | 2 | SC-4 (motion) | — | MotionConfig wraps layout | unit (render assertion) | `npm run test -- app/layout.test.tsx` | ❌ W0 | ⬜ pending |
| 105-03-XX | 03 | 1 | SC-5 (i18n) | — | all 6 locales share identical key set | unit | `npm run test -- tests/i18n/v7-key-parity.test.ts` | ❌ W0 | ⬜ pending |
| 105-03-XX | 03 | 1 | SC-5 (diacritics) | — | french keys contain diacritics | unit | `npm run test -- tests/i18n/v7-key-parity.test.ts` | ❌ W0 | ⬜ pending |
| 105-03-XX | 03 | 2 | SC-2 (E2E) | — | full stage→job→views→export flow passes | e2e | `npm run test:e2e:workbench` | ❌ W0 | ⬜ pending |
| 105-03-XX | 03 | 2 | SC-4 (reduced-motion) | — | view transition <100ms with reducedMotion=reduce | e2e | `npm run test:e2e:workbench` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `eslint.config.mjs` — ESLint flat config at repo root (Plan 01, required by lint-rule test)
- [ ] `tests/extraction/lint-rule.test.ts` — ESLint programmatic test harness (Plan 01)
- [ ] `tests/i18n/v7-key-parity.test.ts` — locale key parity + diacritic sampling (Plan 03)
- [ ] `convex/extraction/testing.ts` — dev-guarded `seedCompletedJob` internalAction + public wrapper (Plan 03, required by E2E spec)
- [ ] `e2e/helpers/sign-in.ts` — extracted Clerk sign-in helper (Plan 03)
- [ ] `e2e/extraction-workbench.spec.ts` — full v7.0 E2E spec (Plan 03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Zotero OAuth round-trip | SC-2 (partial) | E2E mocks Zotero via `page.route` — live OAuth is covered by manual UAT | UAT: connect a real Zotero account in dev, verify library listing appears |
| Real LLM extraction cascade | SC-2 (partial) | E2E seeds completed job — real cascade takes 1-2 min/paper and is covered by extraction unit suite | UAT: create a real extraction job with 2-3 papers and verify results render |
| Mobile physical-device touch targets | SC-3 (partial) | 44px is a className assertion in unit tests; physical tap ergonomics need human verification | UAT: open `/extraction/new` on a real phone, tap every CTA |
| Visual quality of reduced-motion fallback | SC-4 (partial) | `<100ms` assertion proves animation skipped; aesthetic quality (no jarring snaps) needs human eye | UAT: enable reduced-motion in OS settings, navigate workbench |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
