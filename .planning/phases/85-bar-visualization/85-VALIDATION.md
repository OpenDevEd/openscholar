---
phase: 85
slug: bar-visualization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 85 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 with @testing-library/react 16.3.2 |
| **Config file** | `vitest.config.ts` (environment: jsdom) |
| **Quick run command** | `npm test -- tests/bar-scaling.test.ts tests/bar-validation.test.ts tests/stacked-answer-bars.test.tsx tests/bar-tooltip.test.tsx` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/bar-*.test.ts*`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 85-01-01 | 01 | 1 | BAR-01 | unit | `npm test -- tests/bar-scaling.test.ts` | ❌ W0 | ⬜ pending |
| 85-01-02 | 01 | 1 | BAR-03 | unit | `npm test -- tests/bar-validation.test.ts` | ❌ W0 | ⬜ pending |
| 85-02-01 | 02 | 1 | BAR-02 | unit | `npm test -- tests/stacked-answer-bars.test.tsx` | ❌ W0 | ⬜ pending |
| 85-02-02 | 02 | 1 | BAR-04 | unit | `npm test -- tests/bar-tooltip.test.tsx` | ❌ W0 | ⬜ pending |
| 85-03-01 | 03 | 2 | INFRA-02 | manual | `npm run build && Chrome DevTools Network` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/bar-scaling.test.ts` — stubs for BAR-01 (max-relative normalization)
- [ ] `tests/bar-validation.test.ts` — stubs for BAR-03 (edge case guards)
- [ ] `tests/stacked-answer-bars.test.tsx` — stubs for BAR-02 (stacked bar rendering)
- [ ] `tests/bar-tooltip.test.tsx` — stubs for BAR-04 (tooltip labels on hover/focus)
- [ ] `recharts` dependency in package.json — `npm install recharts@^2.14.0`

*Vitest config already supports jsdom; no framework setup needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Recharts bundle not in initial page load | INFRA-02 | Bundle splitting verified via browser DevTools Network tab | 1. Run `npm run build` 2. Open app in Chrome 3. Check Network tab on page load — no recharts chunk 4. Click insights tab — recharts chunk appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
